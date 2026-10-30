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
    private final com.nora.config.AppProperties props;

    public ChatService(ChatConversationRepository convs, ChatMemberRepository members, ChatMessageRepository messages, RoomService rooms,
                       RoomMemberRepository roomMembers, UserRepository users, NotificationService notifications, ApplicationEventPublisher events, com.nora.config.AppProperties props) {
        this.props = props;
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
        return dtos(visible, p.userId()).stream()
                .filter(c -> !ChatConversation.DM.equals(c.kind()) || c.last() != null || p.userId().equals(c.createdBy()))
                .sorted(ORDER).toList();
    }

    /** Todas las conversaciones de una persona con unas pocas consultas en total (no una tanda por conversación). */
    private List<ConvDto> dtos(List<ChatConversation> list, UUID viewer) {
        if (list.isEmpty()) return List.of();
        List<UUID> ids = list.stream().map(ChatConversation::getId).toList();
        Map<UUID, ChatMember> mine = members.findByUserIdAndConversationIdIn(viewer, ids).stream().collect(Collectors.toMap(ChatMember::getConversationId, m -> m));
        Map<UUID, ChatMessage> lasts = messages.latestOf(ids).stream().collect(Collectors.toMap(ChatMessage::getConversationId, m -> m, (a, b) -> a));
        Map<UUID, Long> unread = new HashMap<>();
        for (Object[] r : messages.unreadCounts(viewer, ids)) unread.put((UUID) r[0], ((Number) r[1]).longValue());
        List<UUID> withMembers = list.stream().filter(c -> !c.isRoom()).map(ChatConversation::getId).toList();
        Map<UUID, List<ChatMember>> byConv = withMembers.isEmpty() ? Map.of() : members.findByConversationIdIn(withMembers).stream().collect(Collectors.groupingBy(ChatMember::getConversationId));
        List<ConvDto> out = new ArrayList<>();
        for (ChatConversation c : list) {
            ChatMember me = mine.get(c.getId());
            ChatMessage last = lasts.get(c.getId());
            List<ChatMember> cms = byConv.getOrDefault(c.getId(), List.of());
            UUID other = null;
            if (c.isDm()) for (ChatMember cm : cms) if (!cm.getUserId().equals(viewer)) other = cm.getUserId();
            out.add(new ConvDto(c.getId(), c.getKind(), c.getName(), c.getDescription(), c.getColor(), c.getCreatedBy(), c.getPostPolicy(), c.getAddPolicy(),
                    c.getCreatedAt(), c.getLastMessageAt(),
                    last == null ? null : new LastMessage(last.getId(), last.getAuthorId(), last.getAuthorName(), last.getKind(), clip(last.getText(), 120), last.getCreatedAt()),
                    c.isGroup() ? sortedMembers(cms) : List.of(), me == null ? "MEMBER" : me.getRole(), me != null && me.isMuted(), me != null && me.isPinned(),
                    me == null ? 0 : unread.getOrDefault(c.getId(), 0L), me == null ? null : me.getLastReadAt(), other));
        }
        return out;
    }

    private static List<MemberDto> sortedMembers(List<ChatMember> l) {
        return l.stream().sorted(java.util.Comparator.comparing((ChatMember m) -> !m.isAdmin()).thenComparing(ChatMember::getJoinedAt)).map(m -> new MemberDto(m.getUserId(), m.getRole())).toList();
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
        return dtos(found);
    }

    /** Los posteriores a un mensaje, para bajar paso a paso desde una ventana que no llega al final. */
    @Transactional(readOnly = true)
    public List<MessageDto> messagesAfter(AuthPrincipal p, String code, UUID id, Instant after, int limit) {
        Ctx x = ctx(p, code, id);
        return dtos(messages.findAfter(x.conv().getId(), after, PageRequest.of(0, Math.max(1, Math.min(limit, 200)))));
    }

    /** Una ventana de mensajes centrada en uno concreto: sirve para ir a un mensaje antiguo sin cargar todo lo que hay entre medias. */
    @Transactional(readOnly = true)
    public WindowDto window(AuthPrincipal p, String code, UUID id, UUID around, int limit) {
        Ctx x = ctx(p, code, id);
        ChatMessage target = messages.findByIdAndConversationId(around, id).orElseThrow(() -> ApiException.notFound("Ese mensaje ya no existe"));
        int half = Math.max(5, Math.min(limit, 100)) / 2;
        List<ChatMessage> older = new ArrayList<>(messages.findBefore(id, target.getCreatedAt(), PageRequest.of(0, half)));
        java.util.Collections.reverse(older);
        List<ChatMessage> newer = messages.findFrom(id, target.getCreatedAt(), PageRequest.of(0, half + 1));
        boolean hasNewer = newer.size() > half;
        List<ChatMessage> all = new ArrayList<>(older);
        all.addAll(newer.stream().limit(half).toList());
        return new WindowDto(dtos(all), older.size() >= half, hasNewer);
    }

    /** Busca texto en el historial (en una conversación o en todas las que ve esta persona). Los resultados van de más reciente a más antiguo. */
    @Transactional(readOnly = true)
    public SearchDto search(AuthPrincipal p, String code, UUID conv, String query, Instant before, int limit) {
        Room room = rooms.requireMember(p.userId(), code);
        String q = query == null ? "" : query.strip();
        if (q.length() < 2) return new SearchDto(List.of(), false);
        if (q.length() > 100) q = q.substring(0, 100);
        List<UUID> ids;
        if (conv != null) {
            ids = List.of(ctx(p, code, conv).conv().getId());
        } else {
            ids = convs.findVisible(room.getId(), p.userId()).stream().map(ChatConversation::getId).toList();
        }
        if (ids.isEmpty()) return new SearchDto(List.of(), false);
        String pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        int n = Math.max(1, Math.min(limit, 50));
        List<ChatMessage> found = messages.search(ids, pattern, before == null ? Instant.now().plusSeconds(60) : before, n + 1);
        return new SearchDto(dtos(found.stream().limit(n).toList()), found.size() > n);
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
        MessageDto dto = dto(m);
        deliver(x.room(), c, "chat.message", dto);
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
        MessageDto dto = dto(m);
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
        MessageDto dto = dto(m);
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
        members.ensureRoomMembers(c.getId(), room.getId(), readUntil);
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
        deliver(room, c, "chat.message", dto(m));
    }

    /**
     * Avisos en la campana por mensajes de chat: no al instante, sino cuando llevan más de N minutos (por defecto 2 horas) sin leerse. Así el chat en
     * vivo no llena la campana, y a quien no entró a verlo le llega un solo aviso por conversación con lo que se perdió.
     */
    @org.springframework.scheduling.annotation.Scheduled(fixedDelayString = "#{${app.chat.check-seconds:300} * 1000}", initialDelayString = "#{${app.chat.check-seconds:300} * 1000}")
    @Transactional
    public void notifyUnanswered() {
        int mins = Math.max(1, props.chat() == null ? 120 : props.chat().notifyAfterMinutes());
        Map<UUID, Room> roomCache = new HashMap<>();
        Map<UUID, String> dmNames = new HashMap<>();
        for (Object[] r : members.unansweredFor(mins)) {
            UUID conv = (UUID) r[0];
            UUID user = (UUID) r[1];
            UUID roomId = (UUID) r[2];
            String kind = (String) r[3];
            String groupName = (String) r[4];
            long n = ((Number) r[5]).longValue();
            UUID lastId = (UUID) r[6];
            String lastAuthor = (String) r[7];
            String lastText = (String) r[8];
            Instant lastAt = r[9] instanceof java.sql.Timestamp ts ? ts.toInstant() : (Instant) r[9];
            Room room = roomCache.computeIfAbsent(roomId, rooms::roomById);
            if (room == null || !roomMembers.existsById(new RoomMember.Key(roomId, user))) { members.markNotified(conv, user, lastAt); continue; }
            String where = ChatConversation.ROOM.equals(kind) ? "el chat general" : ChatConversation.GROUP.equals(kind) ? "«" + groupName + "»" : lastAuthor;
            String title = n == 1 ? (ChatConversation.DM.equals(kind) ? lastAuthor + " te escribió" : "Mensaje sin leer en " + where)
                    : n + " mensajes sin leer " + (ChatConversation.DM.equals(kind) ? "de " + lastAuthor : "en " + where);
            Map<String, Object> link = new LinkedHashMap<>();
            link.put("tool", "chat");
            link.put("conv", conv.toString());
            link.put("msg", lastId.toString());
            notifications.notify(user, room, "chat", title, (ChatConversation.DM.equals(kind) ? "" : lastAuthor + ": ") + lastText, link, "chat:" + conv);
            members.markNotified(conv, user, lastAt);
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
        return sortedMembers(members.findByConversationId(c.getId()));
    }

    private static MessageDto msg(ChatMessage m, ReplyPreview reply) {
        return new MessageDto(m.getId(), m.getConversationId(), m.getAuthorId(), m.getAuthorName(), m.getKind(), m.getText(), m.getReplyTo(), reply,
                m.getReactions(), m.isEdited(), m.getCreatedAt(), m.getUpdatedAt());
    }

    /** Pasa mensajes a DTO resolviendo de una vez las citas de todos ellos (una consulta, no una por mensaje). */
    private List<MessageDto> dtos(java.util.Collection<ChatMessage> list) {
        java.util.Set<UUID> ids = list.stream().map(ChatMessage::getReplyTo).filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        Map<UUID, ChatMessage> cited = ids.isEmpty() ? Map.of() : messages.findAllById(ids).stream().collect(Collectors.toMap(ChatMessage::getId, m -> m));
        return list.stream().map(m -> {
            ChatMessage c = m.getReplyTo() == null ? null : cited.get(m.getReplyTo());
            return msg(m, c == null ? null : new ReplyPreview(c.getId(), c.getAuthorName(), clip(c.getText(), 160)));
        }).toList();
    }

    private MessageDto dto(ChatMessage m) {
        return dtos(List.of(m)).get(0);
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
