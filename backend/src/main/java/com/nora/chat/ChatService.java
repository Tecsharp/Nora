package com.nora.chat;

import com.nora.auth.AuthPrincipal;
import com.nora.chat.ChatDtos.*;
import com.nora.common.ApiException;
import com.nora.notify.NotificationService;
import com.nora.room.Room;
import com.nora.room.RoomMember;
import com.nora.room.RoomMemberRepository;
import com.nora.room.RoomService;
import com.nora.user.User;
import com.nora.user.UserRepository;
import com.nora.ws.RoomEvent;
import com.nora.ws.UserEvent;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Chat de la sala: una conversación general (todas las personas), grupos con sus ajustes y mensajes directos.
 * Todo se reparte en vivo y solo a quien participa en cada conversación (eventos {@code chat.*} de usuario, no de sala).
 * Quien tiene rol de lector puede leer y reaccionar, pero no escribir; los grupos y mensajes directos solo existen entre participantes de la sala.
 */
@Service
public class ChatService {

    private static final Pattern COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final int MAX_GROUPS = 100;
    private static final Set<String> POLICIES = Set.of("ALL", "ADMINS");

    private final ChatConversationRepository convs;
    private final ChatMemberRepository members;
    private final ChatMessageRepository messages;
    private final RoomService rooms;
    private final RoomMemberRepository roomMembers;
    private final UserRepository users;
    private final NotificationService notifications;
    private final ApplicationEventPublisher events;

    public ChatService(ChatConversationRepository convs, ChatMemberRepository members, ChatMessageRepository messages, RoomService rooms,
                       RoomMemberRepository roomMembers, UserRepository users, NotificationService notifications, ApplicationEventPublisher events) {
        this.convs = convs;
        this.members = members;
        this.messages = messages;
        this.rooms = rooms;
        this.roomMembers = roomMembers;
        this.users = users;
        this.notifications = notifications;
        this.events = events;
    }

    /** Contexto de una petición: la sala, la conversación y la fila de quien pregunta (si ya la tiene). */
    private record Ctx(Room room, ChatConversation conv, ChatMember me) {}

    // ---- conversaciones ----

    @Transactional
    public List<ConvDto> list(AuthPrincipal p, String code) {
        Room room = rooms.requireMember(p.userId(), code);
        ChatConversation general = general(room);
        member(general, p.userId()); // la general siempre me pertenece (para llevar mi lectura)
        List<ChatConversation> visible = convs.findVisible(room.getId(), p.userId());
        // un mensaje directo vacío solo lo ve quien lo abrió: a la otra persona le aparece con el primer mensaje
        return visible.stream().map(c -> dto(c, p.userId(), room))
                .filter(c -> !ChatConversation.DM.equals(c.kind()) || c.last() != null || p.userId().equals(c.createdBy()))
                .sorted(ORDER).toList();
    }

    private static final java.util.Comparator<ConvDto> ORDER = java.util.Comparator
            .comparing((ConvDto c) -> !c.pinned())
            .thenComparing(ConvDto::lastMessageAt, java.util.Comparator.reverseOrder());

    @Transactional
    public ConvDto createGroup(AuthPrincipal p, String code, CreateGroup req) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        if (convs.countByRoomIdAndKind(room.getId(), ChatConversation.GROUP) >= MAX_GROUPS) throw ApiException.conflict("La sala ya tiene el máximo de grupos");
        String name = name(req.name());
        ChatConversation c = new ChatConversation(room.getId(), ChatConversation.GROUP, name, p.userId());
        c.setDescription(clip(req.description(), 300));
        c.setColor(color(req.color()));
        convs.save(c);
        members.save(new ChatMember(c.getId(), p.userId(), "ADMIN"));
        List<UUID> added = new ArrayList<>();
        for (UUID u : distinct(req.members())) {
            if (u.equals(p.userId())) continue;
            requireInRoom(room, u);
            members.save(new ChatMember(c.getId(), u, "MEMBER"));
            added.add(u);
        }
        system(c, p.userId(), actor(p) + " creó el grupo «" + name + "»", room);
        notifyConv(room, c, "created");
        return dto(c, p.userId(), room);
    }

    @Transactional
    public ConvDto openDm(AuthPrincipal p, String code, UUID otherId) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        if (otherId == null || otherId.equals(p.userId())) throw ApiException.badRequest("Elige a otra persona");
        requireInRoom(room, otherId);
        String key = p.userId().compareTo(otherId) < 0 ? p.userId() + ":" + otherId : otherId + ":" + p.userId();
        ChatConversation c = convs.findByRoomIdAndDmKey(room.getId(), key).orElse(null);
        if (c == null) {
            c = new ChatConversation(room.getId(), ChatConversation.DM, null, p.userId());
            c.setDmKey(key);
            convs.save(c);
            members.save(new ChatMember(c.getId(), p.userId(), "MEMBER"));
            members.save(new ChatMember(c.getId(), otherId, "MEMBER"));
            // la otra persona no ve la conversación hasta que haya un primer mensaje: no se le avisa todavía
            events.publishEvent(new UserEvent(p.userId(), "chat.conv", Map.of("room", room.getCode(), "conv", c.getId(), "op", "created")));
        }
        return dto(c, p.userId(), room);
    }

    @Transactional
    public ConvDto updateGroup(AuthPrincipal p, String code, UUID id, UpdateGroup req) {
        Ctx x = ctx(p, code, id);
        requireGroup(x.conv());
        requireAdmin(x);
        List<String> changes = new ArrayList<>();
        if (req.name() != null && !req.name().strip().equals(x.conv().getName())) {
            x.conv().setName(name(req.name()));
            changes.add("cambió el nombre a «" + x.conv().getName() + "»");
        }
        if (req.description() != null) x.conv().setDescription(clip(req.description(), 300));
        if (req.color() != null) x.conv().setColor(color(req.color()));
        if (req.postPolicy() != null) {
            policy(req.postPolicy());
            if (!req.postPolicy().equals(x.conv().getPostPolicy())) changes.add(req.postPolicy().equals("ADMINS") ? "dejó que solo las personas administradoras escriban" : "permitió que todas las personas escriban");
            x.conv().setPostPolicy(req.postPolicy());
        }
        if (req.addPolicy() != null) {
            policy(req.addPolicy());
            x.conv().setAddPolicy(req.addPolicy());
        }
        convs.save(x.conv());
        for (String ch : changes) system(x.conv(), p.userId(), actor(p) + " " + ch, x.room());
        notifyConv(x.room(), x.conv(), "updated");
        return dto(x.conv(), p.userId(), x.room());
    }

    @Transactional
    public List<MemberDto> addMembers(AuthPrincipal p, String code, UUID id, AddMembers req) {
        Ctx x = ctx(p, code, id);
        requireGroup(x.conv());
        if (x.conv().getAddPolicy().equals("ADMINS")) requireAdmin(x);
        List<String> names = new ArrayList<>();
        for (UUID u : distinct(req.userIds())) {
            if (members.existsById(new ChatMember.Key(id, u))) continue;
            requireInRoom(x.room(), u);
            members.save(new ChatMember(id, u, "MEMBER"));
            names.add(userName(u));
        }
        if (!names.isEmpty()) {
            system(x.conv(), p.userId(), actor(p) + " añadió a " + String.join(", ", names), x.room());
            notifyConv(x.room(), x.conv(), "members");
        }
        return memberDtos(x.conv());
    }

    /** Quitar a otra persona (administración) o salir uno mismo. */
    @Transactional
    public void removeMember(AuthPrincipal p, String code, UUID id, UUID target) {
        Ctx x = ctx(p, code, id);
        requireGroup(x.conv());
        boolean self = target.equals(p.userId());
        if (!self) requireAdmin(x);
        ChatMember m = members.findById(new ChatMember.Key(id, target)).orElseThrow(() -> ApiException.notFound("Esa persona no está en el grupo"));
        List<UUID> before = recipients(x.conv(), x.room());
        members.delete(m);
        members.flush();
        List<ChatMember> left = members.findByConversationId(id);
        if (left.isEmpty()) {
            deleteConversation(x.room(), x.conv(), before);
            return;
        }
        if (m.isAdmin() && left.stream().noneMatch(ChatMember::isAdmin)) {
            ChatMember next = left.stream().min(java.util.Comparator.comparing(ChatMember::getJoinedAt)).orElseThrow();
            next.setRole("ADMIN"); // el grupo nunca se queda sin administración
            members.save(next);
        }
        system(x.conv(), p.userId(), self ? actor(p) + " salió del grupo" : actor(p) + " quitó a " + userName(target), x.room());
        events.publishEvent(new UserEvent(target, "chat.conv", Map.of("room", x.room().getCode(), "conv", id, "op", "removed")));
        notifyConv(x.room(), x.conv(), "members");
    }

    @Transactional
    public List<MemberDto> setRole(AuthPrincipal p, String code, UUID id, UUID target, String role) {
        Ctx x = ctx(p, code, id);
        requireGroup(x.conv());
        requireAdmin(x);
        if (!Set.of("ADMIN", "MEMBER").contains(role)) throw ApiException.badRequest("Rol no válido");
        ChatMember m = members.findById(new ChatMember.Key(id, target)).orElseThrow(() -> ApiException.notFound("Esa persona no está en el grupo"));
        if (m.isAdmin() && role.equals("MEMBER") && members.findByConversationId(id).stream().filter(ChatMember::isAdmin).count() <= 1) {
            throw ApiException.conflict("El grupo necesita al menos una persona administradora");
        }
        m.setRole(role);
        members.save(m);
        system(x.conv(), p.userId(), actor(p) + (role.equals("ADMIN") ? " nombró administrador a " : " quitó la administración a ") + userName(target), x.room());
        notifyConv(x.room(), x.conv(), "members");
        return memberDtos(x.conv());
    }

    @Transactional
    public ConvDto prefs(AuthPrincipal p, String code, UUID id, Prefs req) {
        Ctx x = ctx(p, code, id);
        ChatMember m = member(x.conv(), p.userId());
        if (req.muted() != null) m.setMuted(req.muted());
        if (req.pinned() != null) m.setPinned(req.pinned());
        members.save(m);
        events.publishEvent(new UserEvent(p.userId(), "chat.conv", Map.of("room", x.room().getCode(), "conv", id, "op", "updated")));
        return dto(x.conv(), p.userId(), x.room());
    }

    @Transactional
    public void markRead(AuthPrincipal p, String code, UUID id) {
        Ctx x = ctx(p, code, id);
        ChatMember m = member(x.conv(), p.userId());
        m.setLastReadAt(Instant.now());
        members.save(m);
        notifications.markGroupRead(p.userId(), "chat:" + id);
        notifications.markGroupRead(p.userId(), "chat:" + id + ":mention");
        events.publishEvent(new UserEvent(p.userId(), "chat.read", Map.of("room", x.room().getCode(), "conv", id)));
    }

    @Transactional
    public void deleteGroup(AuthPrincipal p, String code, UUID id) {
        Ctx x = ctx(p, code, id);
        requireGroup(x.conv());
        if (!(x.me() != null && x.me().isAdmin()) && !p.userId().equals(x.conv().getCreatedBy())) throw ApiException.forbidden("Solo quien administra el grupo puede borrarlo");
        deleteConversation(x.room(), x.conv(), recipients(x.conv(), x.room()));
    }

    private void deleteConversation(Room room, ChatConversation c, Collection<UUID> notify) {
        convs.delete(c);
        for (UUID u : notify) events.publishEvent(new UserEvent(u, "chat.conv", Map.of("room", room.getCode(), "conv", c.getId(), "op", "deleted")));
    }

    // ---- mensajes ----

    @Transactional(readOnly = true)
    public List<MessageDto> messages(AuthPrincipal p, String code, UUID id, Instant before, int limit) {
        Ctx x = ctx(p, code, id);
        List<ChatMessage> found = new ArrayList<>(messages.findBefore(x.conv().getId(), before == null ? Instant.now().plusSeconds(60) : before, PageRequest.of(0, Math.max(1, Math.min(limit, 200)))));
        java.util.Collections.reverse(found); // de más antiguo a más reciente
        return found.stream().map(ChatService::msg).toList();
    }

    @Transactional
    public MessageDto send(AuthPrincipal p, String code, UUID id, SendMessage req) {
        Ctx x = ctx(p, code, id);
        rooms.requireWriter(p.userId(), p.role(), code);
        ChatConversation c = x.conv();
        if (c.isGroup() && c.getPostPolicy().equals("ADMINS") && !(x.me() != null && x.me().isAdmin())) throw ApiException.forbidden("En este grupo solo escriben las personas administradoras");
        String text = text(req.text());
        UUID reply = req.replyTo();
        if (reply != null && messages.findByIdAndConversationId(reply, id).isEmpty()) reply = null;
        ChatMessage m = new ChatMessage(id, p.userId(), actor(p), "TEXT", text, reply);
        messages.save(m);
        c.setLastMessageAt(m.getCreatedAt());
        convs.save(c);
        // quien manda ya lo ha leído todo
        ChatMember mine = member(c, p.userId());
        mine.setLastReadAt(m.getCreatedAt());
        members.save(mine);
        if (c.isRoom()) ensureRoomMembers(c, x.room(), m.getCreatedAt().minusMillis(1));
        MessageDto dto = msg(m);
        deliver(x.room(), c, "chat.message", dto);
        notifyMessage(x.room(), c, m, p.userId());
        return dto;
    }

    @Transactional
    public MessageDto edit(AuthPrincipal p, String code, UUID id, UUID messageId, String newText) {
        Ctx x = ctx(p, code, id);
        rooms.requireWriter(p.userId(), p.role(), code);
        ChatMessage m = messages.lockById(messageId, id).orElseThrow(() -> ApiException.notFound("Ese mensaje ya no existe"));
        if (!"TEXT".equals(m.getKind()) || !p.userId().equals(m.getAuthorId())) throw ApiException.forbidden("Solo puedes editar tus mensajes");
        m.setText(text(newText));
        messages.save(m);
        MessageDto dto = msg(m);
        deliver(x.room(), x.conv(), "chat.message.updated", dto);
        return dto;
    }

    @Transactional
    public void deleteMessage(AuthPrincipal p, String code, UUID id, UUID messageId) {
        Ctx x = ctx(p, code, id);
        rooms.requireWriter(p.userId(), p.role(), code);
        ChatMessage m = messages.findByIdAndConversationId(messageId, id).orElseThrow(() -> ApiException.notFound("Ese mensaje ya no existe"));
        boolean own = p.userId().equals(m.getAuthorId());
        boolean staff = x.conv().isRoom() ? rooms.canModerate(x.room(), p.userId(), p.role()) : x.conv().isGroup() && x.me() != null && x.me().isAdmin();
        if (!own && !staff) throw ApiException.forbidden("Solo quien lo escribió o quien modera puede borrarlo");
        messages.delete(m);
        deliver(x.room(), x.conv(), "chat.message.deleted", Map.of("conv", id, "id", messageId));
    }

    @Transactional
    public MessageDto react(AuthPrincipal p, String code, UUID id, UUID messageId, String emojiIn) {
        Ctx x = ctx(p, code, id);
        String emoji = emojiIn == null ? "" : emojiIn.strip();
        if (emoji.isEmpty() || emoji.length() > 16) throw ApiException.badRequest("Reacción no válida");
        ChatMessage m = messages.lockById(messageId, id).orElseThrow(() -> ApiException.notFound("Ese mensaje ya no existe"));
        Map<String, List<String>> r = new LinkedHashMap<>();
        m.getReactions().forEach((k, v) -> r.put(k, new ArrayList<>(v)));
        List<String> who = r.computeIfAbsent(emoji, k -> new ArrayList<>());
        String me = p.userId().toString();
        if (!who.remove(me)) {
            if (r.size() > 12 && who.isEmpty()) throw ApiException.conflict("Este mensaje ya tiene muchas reacciones distintas");
            who.add(me);
        }
        if (who.isEmpty()) r.remove(emoji);
        m.setReactions(r);
        messages.save(m);
        MessageDto dto = msg(m);
        deliver(x.room(), x.conv(), "chat.message.updated", dto);
        return dto;
    }

    /** «Está escribiendo…»: no se guarda, solo se avisa en vivo al resto de la conversación. */
    @Transactional(readOnly = true)
    public void typing(UUID userId, String displayName, UUID roomId, UUID convId) {
        ChatConversation c = convs.findById(convId).orElse(null);
        if (c == null || !c.getRoomId().equals(roomId)) return;
        Room room = rooms.roomById(roomId);
        if (room == null) return;
        List<UUID> to = recipients(c, room);
        if (!to.contains(userId)) return;
        for (UUID u : to) if (!u.equals(userId)) events.publishEvent(new UserEvent(u, "chat.typing", Map.of("room", room.getCode(), "conv", convId, "userId", userId, "name", displayName)));
    }

    /** Quien sale de la sala (o es expulsado) deja sus grupos y conversaciones directas. */
    @EventListener
    void onRoomEvent(RoomEvent e) {
        if ("member.removed".equals(e.type()) && e.data() instanceof Map<?, ?> m && m.get("userId") instanceof UUID u) members.deleteUserInRoom(u, e.roomId());
    }

    // ---- internos ----

    private Ctx ctx(AuthPrincipal p, String code, UUID id) {
        Room room = rooms.requireMember(p.userId(), code);
        ChatConversation c = convs.findByIdAndRoomId(id, room.getId()).orElseThrow(() -> ApiException.notFound("Esa conversación no existe"));
        ChatMember me = members.findById(new ChatMember.Key(id, p.userId())).orElse(null);
        if (me == null && !c.isRoom()) throw ApiException.notFound("Esa conversación no existe"); // los grupos ajenos no se ven
        return new Ctx(room, c, me);
    }

    private ChatConversation general(Room room) {
        convs.insertGeneral(UUID.randomUUID(), room.getId());
        return convs.findByRoomIdAndKind(room.getId(), ChatConversation.ROOM).orElseThrow();
    }

    /** Fila de lectura de una persona; en la general se crea al vuelo (todas las personas de la sala participan). */
    private ChatMember member(ChatConversation c, UUID userId) {
        return members.findById(new ChatMember.Key(c.getId(), userId)).orElseGet(() -> {
            if (!c.isRoom()) throw ApiException.notFound("Esa conversación no existe");
            return members.save(new ChatMember(c.getId(), userId, "MEMBER"));
        });
    }

    private void ensureRoomMembers(ChatConversation c, Room room, Instant readUntil) {
        Set<UUID> have = members.findByConversationId(c.getId()).stream().map(ChatMember::getUserId).collect(Collectors.toSet());
        for (RoomMember rm : roomMembers.findByRoomId(room.getId())) {
            if (have.contains(rm.getUserId())) continue;
            ChatMember m = new ChatMember(c.getId(), rm.getUserId(), "MEMBER");
            m.setLastReadAt(readUntil);
            members.save(m);
        }
    }

    private List<UUID> recipients(ChatConversation c, Room room) {
        if (c.isRoom()) return roomMembers.findByRoomId(room.getId()).stream().map(RoomMember::getUserId).toList();
        return members.findByConversationId(c.getId()).stream().map(ChatMember::getUserId).toList();
    }

    private void deliver(Room room, ChatConversation c, String type, Object payload) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("room", room.getCode());
        body.put("conv", c.getId());
        if (payload instanceof MessageDto d) body.put("message", d);
        else if (payload instanceof Map<?, ?> m) m.forEach((k, v) -> body.put(String.valueOf(k), v));
        for (UUID u : recipients(c, room)) events.publishEvent(new UserEvent(u, type, body));
    }

    private void notifyConv(Room room, ChatConversation c, String op) {
        for (UUID u : recipients(c, room)) events.publishEvent(new UserEvent(u, "chat.conv", Map.of("room", room.getCode(), "conv", c.getId(), "op", op)));
    }

    private void system(ChatConversation c, UUID actorId, String text, Room room) {
        ChatMessage m = new ChatMessage(c.getId(), actorId, "Sistema", "SYSTEM", clip(text, 400), null);
        messages.save(m);
        c.setLastMessageAt(m.getCreatedAt());
        convs.save(c);
        deliver(room, c, "chat.message", msg(m));
    }

    /** Avisos persistentes (la campana): mensajes directos y de grupo, y en la general solo cuando te mencionan. */
    private void notifyMessage(Room room, ChatConversation c, ChatMessage m, UUID author) {
        String name = m.getAuthorName();
        Map<String, Object> link = new LinkedHashMap<>();
        link.put("tool", "chat");
        link.put("conv", c.getId().toString());
        link.put("msg", m.getId().toString());
        if (c.isRoom()) {
            String lower = m.getText().toLowerCase(Locale.ROOT);
            for (RoomMember rm : roomMembers.findByRoomId(room.getId())) {
                if (rm.getUserId().equals(author)) continue;
                String dn = userName(rm.getUserId());
                if (lower.contains("@" + dn.toLowerCase(Locale.ROOT))) {
                    notifications.notify(rm.getUserId(), room, "chat", name + " te mencionó en el chat general", m.getText(), link, "chat:" + c.getId() + ":mention");
                }
            }
            return;
        }
        String title = c.isGroup() ? name + " en " + c.getName() : name;
        for (ChatMember cm : members.findByConversationId(c.getId())) {
            if (cm.getUserId().equals(author) || cm.isMuted()) continue;
            notifications.notify(cm.getUserId(), room, "chat", title, m.getText(), link, "chat:" + c.getId());
        }
    }

    private ConvDto dto(ChatConversation c, UUID viewer, Room room) {
        ChatMember me = members.findById(new ChatMember.Key(c.getId(), viewer)).orElse(null);
        ChatMessage last = messages.latest(c.getId(), PageRequest.of(0, 1)).stream().findFirst().orElse(null);
        long unread = 0;
        if (me != null) {
            unread = messages.unreadCounts(viewer, List.of(c.getId())).stream().mapToLong(r -> ((Number) r[1]).longValue()).sum();
        }
        UUID other = null;
        if (c.isDm()) {
            for (ChatMember cm : members.findByConversationId(c.getId())) if (!cm.getUserId().equals(viewer)) other = cm.getUserId();
        }
        return new ConvDto(c.getId(), c.getKind(), c.getName(), c.getDescription(), c.getColor(), c.getCreatedBy(), c.getPostPolicy(), c.getAddPolicy(),
                c.getCreatedAt(), c.getLastMessageAt(),
                last == null ? null : new LastMessage(last.getId(), last.getAuthorId(), last.getAuthorName(), last.getKind(), clip(last.getText(), 120), last.getCreatedAt()),
                c.isGroup() ? memberDtos(c) : List.of(), me == null ? "MEMBER" : me.getRole(), me != null && me.isMuted(), me != null && me.isPinned(), unread, me == null ? null : me.getLastReadAt(), other);
    }

    private List<MemberDto> memberDtos(ChatConversation c) {
        return members.findByConversationId(c.getId()).stream()
                .sorted(java.util.Comparator.comparing((ChatMember m) -> !m.isAdmin()).thenComparing(ChatMember::getJoinedAt))
                .map(m -> new MemberDto(m.getUserId(), m.getRole())).toList();
    }

    private static MessageDto msg(ChatMessage m) {
        return new MessageDto(m.getId(), m.getConversationId(), m.getAuthorId(), m.getAuthorName(), m.getKind(), m.getText(), m.getReplyTo(),
                m.getReactions(), m.isEdited(), m.getCreatedAt(), m.getUpdatedAt());
    }

    private void requireGroup(ChatConversation c) {
        if (!c.isGroup()) throw ApiException.badRequest("Esto solo se puede hacer en un grupo");
    }

    private void requireAdmin(Ctx x) {
        if (x.me() == null || !x.me().isAdmin()) throw ApiException.forbidden("Solo las personas administradoras del grupo pueden hacerlo");
    }

    private void requireInRoom(Room room, UUID userId) {
        if (!roomMembers.existsById(new RoomMember.Key(room.getId(), userId))) throw ApiException.badRequest("Esa persona no participa en la sala");
    }

    private String userName(UUID id) { return users.findById(id).map(User::getDisplayName).orElse("Alguien"); }

    private String actor(AuthPrincipal p) { return userName(p.userId()); }

    private static List<UUID> distinct(List<UUID> in) {
        return in == null ? List.of() : new ArrayList<>(new LinkedHashSet<>(in));
    }

    private static String name(String s) {
        String n = s == null ? "" : s.strip();
        if (n.isEmpty()) throw ApiException.badRequest("El grupo necesita un nombre");
        if (n.length() > 80) throw ApiException.badRequest("El nombre es demasiado largo (máximo 80 caracteres)");
        return n;
    }

    private static String text(String s) {
        String t = s == null ? "" : s.strip();
        if (t.isEmpty()) throw ApiException.badRequest("El mensaje está vacío");
        if (t.length() > 4000) throw ApiException.badRequest("El mensaje es demasiado largo (máximo 4000 caracteres)");
        return t;
    }

    private static String color(String c) {
        if (c == null || c.isBlank()) return null;
        if (!COLOR.matcher(c).matches()) throw ApiException.badRequest("Color no válido");
        return c.toLowerCase(Locale.ROOT);
    }

    private static void policy(String p) {
        if (!POLICIES.contains(p)) throw ApiException.badRequest("Ajuste no válido");
    }

    private static String clip(String s, int max) {
        String t = s == null ? "" : s.strip();
        return t.length() > max ? t.substring(0, max - 1) + "…" : t;
    }
}
