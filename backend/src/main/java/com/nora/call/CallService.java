package com.nora.call;

import com.fasterxml.jackson.databind.JsonNode;
import com.nora.assist.AssistService;
import com.nora.chat.ChatService;
import com.nora.collab.CollabWs.Peer;
import com.nora.common.ApiException;
import com.nora.notify.NotificationService;
import com.nora.room.Room;
import com.nora.room.RoomService;
import com.nora.user.Role;
import com.nora.ws.RoomEvent;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Llamadas y videollamadas de una sala, al estilo de Google Meet: un código que se comparte, un anfitrión que decide quién entra,
 * mosaico, presentar pantalla, reacciones, mano levantada, subtítulos, modo complementario y un chat que queda en Mensajes.
 *
 * <p>El audio y el video viajan <b>directo entre navegadores</b> (WebRTC en malla, por eso hay un máximo de personas por llamada); aquí solo se
 * hace de «teléfono» (señalización por el WebSocket), se comprueba que quien entra es de la sala y se guarda el estado compartido (quién está,
 * quién tiene la mano levantada, quién espera). Cada pestaña es un participante (su id es el de la conexión WebSocket): así una misma persona
 * puede entrar con la laptop y, como complemento, con el celular.
 *
 * <pre>
 * cliente → servidor                                    servidor → cliente
 *   call.join {code, companion, mic, cam}                 call.joined {code, me, state}   |  call.waiting {code}  |  call.denied {code}
 *   call.leave {code}                                     call.state {code, …}            (a todos, cada vez que algo cambia)
 *   call.me {code, mic, cam, screen, hand}                call.signal {code, from, data}  (WebRTC: oferta, respuesta, ICE)
 *   call.signal {code, to, data}                          call.reaction {code, from, name, emoji}
 *   call.reaction {code, emoji}                           call.caption {code, from, name, text, final}
 *   call.caption {code, text, final}                      call.mute {code}  |  call.removed {code}  |  call.ended {code}
 *   call.admit {code, conn, allow}   (anfitrión)          call.error {code?, message}
 *   call.host {code, action, conn?, access?}  (anfitrión: mute, muteAll, remove, lowerHand, access, end)
 * </pre>
 */
@Service
public class CallService {

    private static final String CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz";
    /** Cualquier emoji sirve como reacción (la ventana de reacciones los ofrece todos): sin letras, números, espacios ni signos de marcado. */
    private static boolean isEmoji(String s) {
        if (s == null || s.isEmpty() || s.length() > 24) return false;
        return s.codePoints().noneMatch(cp -> Character.isLetterOrDigit(cp) || Character.isWhitespace(cp) || Character.isISOControl(cp) || cp == '<' || cp == '>' || cp == '&' || cp == '"' || cp == '\'');
    }
    private static final int MAX_OPEN_PER_ROOM = 5;

    /** Una persona (pestaña) dentro de la llamada. */
    static final class Part {
        final String conn;
        final UUID userId;
        final String name;
        final boolean host;
        volatile boolean companion;
        volatile boolean mic;
        volatile boolean cam;
        volatile boolean cc;
        volatile String screen;
        volatile Long hand;
        final Instant joined = Instant.now();

        Part(String conn, UUID userId, String name, boolean host, boolean companion, boolean mic, boolean cam) {
            this.conn = conn;
            this.userId = userId;
            this.name = name;
            this.host = host;
            this.companion = companion;
            this.mic = mic;
            this.cam = cam;
        }
    }

    record Waiting(String conn, UUID userId, String name, boolean companion, boolean mic, boolean cam) {}

    /** Estado en vivo de una llamada (en memoria: las llamadas duran lo que dura la gente en ellas). */
    static final class Live {
        final List<Part> parts = new CopyOnWriteArrayList<>();
        final Map<String, Waiting> lobby = new LinkedHashMap<>();
        volatile Instant emptySince = Instant.now();
        /** Quiénes están invitadas (para la lista de «Invitadas que no han entrado»); se calcula una vez por minuto, no en cada cambio de estado. */
        volatile List<Map<String, Object>> invitedBase;
        volatile Instant invitedAt = Instant.EPOCH;
        /** Quien se cayó hace un momento (corte de red) vuelve a entrar sin tener que esperar de nuevo al anfitrión. */
        final Map<UUID, Instant> recent = new ConcurrentHashMap<>();
    }

    public record CallDto(String code, String title, String access, UUID hostId, String hostName, String roomCode, String roomName, UUID conversationId,
                          Instant createdAt, Instant endedAt, List<String> people, int count, int max, Instant scheduledAt, Instant scheduledEnd) {}

    private final CallRepository calls;
    private final com.nora.item.RoomItemRepository roomItems;
    private final com.nora.room.RoomMemberRepository roomMembers;
    private final com.nora.user.UserRepository users;
    private final RoomService rooms;
    private final ChatService chat;
    private final NotificationService notifications;
    private final ApplicationEventPublisher events;
    private final int maxParticipants;
    private final int emptyMinutes;
    private final Map<String, Live> live = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();
    private volatile AssistService.Hub hub;

    public CallService(CallRepository calls, com.nora.item.RoomItemRepository roomItems, com.nora.room.RoomMemberRepository roomMembers, com.nora.user.UserRepository users, @Lazy RoomService rooms, @Lazy ChatService chat, NotificationService notifications, ApplicationEventPublisher events,
                       @Value("${NORA_CALL_MAX_PARTICIPANTS:8}") int maxParticipants, @Value("${NORA_CALL_EMPTY_MINUTES:10}") int emptyMinutes) {
        this.calls = calls;
        this.roomItems = roomItems;
        this.roomMembers = roomMembers;
        this.users = users;
        this.rooms = rooms;
        this.chat = chat;
        this.notifications = notifications;
        this.events = events;
        this.maxParticipants = Math.max(2, maxParticipants);
        this.emptyMinutes = Math.max(1, emptyMinutes);
    }

    public void setHub(AssistService.Hub hub) { this.hub = hub; }

    // ---------------------------------------------------------------- REST

    @Transactional
    public CallDto create(UUID userId, String userName, String roomCode, String title, String access) {
        Room room = rooms.requireMember(userId, roomCode);
        if (calls.countByRoomIdAndEndedAtIsNullAndScheduledAtIsNull(room.getId()) >= MAX_OPEN_PER_ROOM) throw ApiException.conflict("Ya hay varias llamadas abiertas en esta sala; termina alguna antes de abrir otra");
        String t = title == null ? "" : title.strip();
        if (t.length() > 80) t = t.substring(0, 80);
        String acc = Call.ACCESS_OPEN.equalsIgnoreCase(access) ? Call.ACCESS_OPEN : Call.ACCESS_HOST;
        Call c = null;
        for (int i = 0; i < 8 && c == null; i++) {
            String code = newCode();
            if (calls.findByCode(code).isEmpty()) c = new Call(code, room.getId(), userId, userName, t, acc);
        }
        if (c == null) throw ApiException.conflict("No se pudo crear la llamada, inténtalo otra vez");
        calls.save(c);
        live.put(c.getCode(), new Live());
        events.publishEvent(new RoomEvent(room.getId(), "call.started", Map.of("code", c.getCode(), "title", t, "hostName", userName)));
        notifications.notifyRoom(room, userId, "call", userName + " inició una llamada", t.isEmpty() ? "Toca para unirte" : t, Map.of("call", c.getCode()), null);
        return dto(c, room);
    }

    /** Llamada programada desde un evento del calendario: sin avisos de «llamada iniciada» (el evento ya invita) y sin terminar sola antes de su hora. */
    @Transactional
    public String createScheduled(Room room, UUID hostId, String hostName, String title, boolean open, Long startMs, Long endMs, UUID eventId) {
        Call c = null;
        for (int i = 0; i < 8 && c == null; i++) {
            String code = newCode();
            if (calls.findByCode(code).isEmpty()) c = new Call(code, room.getId(), hostId, hostName, clip(title), open ? Call.ACCESS_OPEN : Call.ACCESS_HOST);
        }
        if (c == null) throw ApiException.conflict("No se pudo crear la llamada, inténtalo otra vez");
        c.schedule(startMs == null ? null : Instant.ofEpochMilli(startMs), endMs == null ? null : Instant.ofEpochMilli(endMs), eventId);
        calls.save(c);
        return c.getCode();
    }

    /** El evento cambió de título u hora. */
    @Transactional
    public void reschedule(String code, String title, Long startMs, Long endMs) {
        calls.findByCode(code).filter(c -> !c.isEnded()).ifPresent(c -> {
            c.setTitle(clip(title));
            c.schedule(startMs == null ? null : Instant.ofEpochMilli(startMs), endMs == null ? null : Instant.ofEpochMilli(endMs), c.getEventId());
            calls.save(c);
        });
    }

    /** Se quitó la llamada del evento (o se borró el evento): termina, y si había gente dentro, también para ellos. */
    @Transactional
    public void cancelScheduled(String code) {
        calls.findByCode(code).filter(c -> !c.isEnded()).ifPresent(c -> finish(c, rooms.roomById(c.getRoomId())));
    }

    private static String clip(String t) {
        String s = t == null ? "" : t.strip();
        return s.length() > 80 ? s.substring(0, 80) : s;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> list(UUID userId, String roomCode) {
        Room room = rooms.requireMember(userId, roomCode);
        List<CallDto> active = calls.findByRoomIdAndEndedAtIsNullOrderByCreatedAtDesc(room.getId()).stream().map(c -> dto(c, room)).toList();
        List<CallDto> recent = calls.recent(room.getId(), PageRequest.of(0, 8)).stream().map(c -> dto(c, room)).toList();
        return Map.of("active", active, "recent", recent, "max", maxParticipants);
    }

    /** Datos de una llamada para quien tiene su código; solo si es de la sala (si no, parece que no existe). */
    @Transactional(readOnly = true)
    public CallDto info(UUID userId, String code) {
        Call c = calls.findByCode(normalize(code)).orElseThrow(() -> ApiException.notFound("Esa llamada no existe"));
        Room room = rooms.roomById(c.getRoomId());
        if (room == null) throw ApiException.notFound("Esa llamada no existe");
        try {
            rooms.requireMember(userId, room.getCode());
        } catch (ApiException e) {
            throw ApiException.notFound("Esa llamada no existe");
        }
        return dto(c, room);
    }

    @Transactional
    public CallDto end(UUID userId, String code) {
        Call c = open(code);
        Room room = rooms.roomById(c.getRoomId());
        if (!isHost(c, room, userId)) throw ApiException.forbidden("Solo el anfitrión puede terminar la llamada");
        finish(c, room);
        return dto(c, room);
    }

    /** Crea el chat de la llamada (un grupo en Mensajes con quienes están ahora en ella) o devuelve el que ya existe. */
    @Transactional
    public UUID createChat(UUID userId, String userName, String code) {
        Call c = open(code);
        Room room = rooms.roomById(c.getRoomId());
        Live l = live.get(c.getCode());
        boolean inside = l != null && l.parts.stream().anyMatch(p -> p.userId.equals(userId));
        if (!inside && !isHost(c, room, userId)) throw ApiException.forbidden("Entra primero en la llamada");
        if (c.getConversationId() != null) return c.getConversationId();
        Set<UUID> people = new LinkedHashSet<>();
        if (l != null) for (Part p : l.parts) people.add(p.userId);
        UUID conv = chat.createCallChat(room, userId, userName, callChatName(c, l, userName), people);
        c.setConversationId(conv);
        calls.save(c);
        if (l != null) broadcast(c, l);
        return conv;
    }

    /** Nombre del chat de una llamada: su código y las personas (las que están dentro y las invitadas), p. ej. «abc-defg-hij, Abisai Vázquez, Josué Zala». */
    private String callChatName(Call c, Live l, String creatorName) {
        List<String> names = new ArrayList<>();
        names.add(creatorName);
        if (l != null) {
            for (Part p : l.parts) if (!names.contains(p.name)) names.add(p.name);
            for (Map<String, Object> m : invited(c, l)) { String n = String.valueOf(m.get("name")); if (!names.contains(n)) names.add(n); }
        }
        StringBuilder sb = new StringBuilder(c.getCode());
        for (String n : names) {
            if (sb.length() + 2 + n.length() > 79) { sb.append('…'); break; }
            sb.append(", ").append(n);
        }
        return sb.toString();
    }

    // ---------------------------------------------------------------- WebSocket

    public void join(Peer from, JsonNode msg) {
        String code = normalize(msg.path("code").asText(""));
        Call c = calls.findByCode(code).filter(x -> !x.isEnded()).orElse(null);
        if (c == null) { error(from, code, "Esa llamada no existe o ya terminó"); return; }
        Room room = rooms.roomById(c.getRoomId());
        try {
            if (room == null) throw ApiException.notFound("Esa llamada no existe");
            rooms.requireMember(from.userId(), room.getCode());
        } catch (ApiException e) {
            error(from, code, "No tienes acceso a esta llamada");
            return;
        }
        boolean host = isHost(c, room, from.userId());
        boolean companion = msg.path("companion").asBoolean(false);
        Live l = live.computeIfAbsent(code, k -> new Live());
        boolean admitted;
        synchronized (l) {
            Part mine = find(l, from.id());
            if (mine != null) { from.send("call.joined", Map.of("code", code, "me", from.id(), "state", snapshot(c, l, mine))); return; }
            if (l.lobby.containsKey(from.id())) { from.send("call.waiting", Map.of("code", code)); return; }
            if (l.parts.size() >= maxParticipants) { error(from, code, "La llamada está llena (máximo " + maxParticipants + " personas)"); return; }
            boolean sameUserInside = l.parts.stream().anyMatch(p -> p.userId.equals(from.userId())); // su otro dispositivo (complemento) ya está dentro
            Instant before = l.recent.remove(from.userId());
            boolean justDropped = before != null && before.isAfter(Instant.now().minusSeconds(120));
            admitted = host || Call.ACCESS_OPEN.equals(c.getAccess()) || sameUserInside || justDropped;
            if (admitted) {
                l.parts.add(new Part(from.id(), from.userId(), from.displayName(), host, companion, !companion && msg.path("mic").asBoolean(true), msg.path("cam").asBoolean(true)));
                l.emptySince = null;
            } else {
                l.lobby.put(from.id(), new Waiting(from.id(), from.userId(), from.displayName(), companion, !companion && msg.path("mic").asBoolean(true), msg.path("cam").asBoolean(true)));
            }
        }
        if (admitted) welcome(c, l, from);
        else {
            from.send("call.waiting", Map.of("code", code));
            broadcast(c, l); // los anfitriones ven quién espera
        }
    }

    private void welcome(Call c, Live l, Peer who) {
        Part me = find(l, who.id());
        if (me == null) return;
        if (c.getConversationId() != null) {
            try { chat.joinCallChat(c.getConversationId(), who.userId()); } catch (RuntimeException ignored) { /* el chat es un extra */ }
        }
        who.send("call.joined", Map.of("code", c.getCode(), "me", who.id(), "state", snapshot(c, l, me)));
        broadcast(c, l);
    }

    public void leave(Peer from, JsonNode msg) {
        String code = normalize(msg.path("code").asText(""));
        Live l = live.get(code);
        if (l != null) remove(code, l, from.id(), true); // quien cuelga a propósito no queda con permiso de reentrada
    }

    /** Se cerró la pestaña o se cayó la conexión. */
    public void peerGone(Peer p) {
        for (Map.Entry<String, Live> e : live.entrySet()) remove(e.getKey(), e.getValue(), p.id());
    }

    private void remove(String code, Live l, String conn) { remove(code, l, conn, false); }

    private void remove(String code, Live l, String conn, boolean kicked) {
        boolean changed;
        synchronized (l) {
            for (Part p : l.parts) if (p.conn.equals(conn) && !kicked) l.recent.put(p.userId, Instant.now());
            changed = l.parts.removeIf(p -> p.conn.equals(conn)) | (l.lobby.remove(conn) != null);
            if (l.parts.isEmpty() && l.emptySince == null) l.emptySince = Instant.now();
        }
        if (!changed) return;
        Call c = calls.findByCode(code).orElse(null);
        if (c != null) broadcast(c, l);
    }

    public void me(Peer from, JsonNode msg) {
        Call c = calls.findByCode(normalize(msg.path("code").asText(""))).orElse(null);
        Live l = c == null ? null : live.get(c.getCode());
        Part p = l == null ? null : find(l, from.id());
        if (p == null) return;
        if (msg.has("mic")) p.mic = msg.path("mic").asBoolean(false) && !p.companion;
        if (msg.has("cam")) p.cam = msg.path("cam").asBoolean(false);
        if (msg.has("cc")) p.cc = msg.path("cc").asBoolean(false);
        if (msg.has("screen")) { String s = msg.path("screen").asText(""); p.screen = s.isBlank() || s.length() > 80 ? null : s; }
        if (msg.has("hand")) p.hand = msg.path("hand").asBoolean(false) ? (p.hand != null ? p.hand : System.currentTimeMillis()) : null;
        if (msg.has("companion")) { p.companion = msg.path("companion").asBoolean(false); if (p.companion) p.mic = false; }
        broadcast(c, l);
    }

    public void signal(Peer from, JsonNode msg) {
        Live l = live.get(normalize(msg.path("code").asText("")));
        if (l == null || find(l, from.id()) == null) return;
        String to = msg.path("to").asText("");
        if (find(l, to) == null) return;
        JsonNode data = msg.path("data");
        if (!data.isObject() || data.toString().length() > 64 * 1024) return;
        Peer target = hub == null ? null : hub.peer(to);
        if (target != null) target.send("call.signal", Map.of("code", normalize(msg.path("code").asText("")), "from", from.id(), "data", data));
    }

    public void reaction(Peer from, JsonNode msg) {
        String code = normalize(msg.path("code").asText(""));
        Live l = live.get(code);
        Part p = l == null ? null : find(l, from.id());
        String emoji = msg.path("emoji").asText("");
        if (p == null || !isEmoji(emoji)) return;
        sendAll(l, "call.reaction", Map.of("code", code, "from", from.id(), "name", p.name, "emoji", emoji));
    }

    /** Subtítulos: cada navegador transcribe lo que dice su persona y lo reparte; el servidor solo lo reenvía (no lo guarda). */
    public void caption(Peer from, JsonNode msg) {
        String code = normalize(msg.path("code").asText(""));
        Live l = live.get(code);
        Part p = l == null ? null : find(l, from.id());
        String text = msg.path("text").asText("");
        if (p == null || text.isBlank()) return;
        if (text.length() > 300) text = text.substring(text.length() - 300);
        sendAll(l, "call.caption", Map.of("code", code, "from", from.id(), "name", p.name, "text", text, "final", msg.path("final").asBoolean(false)));
    }

    public void admit(Peer from, JsonNode msg) {
        String code = normalize(msg.path("code").asText(""));
        Call c = calls.findByCode(code).filter(x -> !x.isEnded()).orElse(null);
        Live l = c == null ? null : live.get(code);
        Part me = l == null ? null : find(l, from.id());
        if (me == null || !me.host) return;
        String conn = msg.path("conn").asText("");
        boolean allow = msg.path("allow").asBoolean(false);
        Waiting w;
        synchronized (l) {
            w = l.lobby.remove(conn);
            if (w != null && allow) {
                if (l.parts.size() >= maxParticipants) { w = null; }
                else {
                    Room room = rooms.roomById(c.getRoomId());
                    l.parts.add(new Part(w.conn(), w.userId(), w.name(), room != null && isHost(c, room, w.userId()), w.companion(), w.mic(), w.cam()));
                    l.emptySince = null;
                }
            }
        }
        if (w == null) { broadcast(c, l); return; }
        Peer target = hub == null ? null : hub.peer(w.conn());
        if (allow) {
            if (target != null) welcome(c, l, target);
        } else {
            if (target != null) target.send("call.denied", Map.of("code", code));
            broadcast(c, l);
        }
    }

    public void host(Peer from, JsonNode msg) {
        String code = normalize(msg.path("code").asText(""));
        Call c = calls.findByCode(code).filter(x -> !x.isEnded()).orElse(null);
        Live l = c == null ? null : live.get(code);
        Part me = l == null ? null : find(l, from.id());
        if (me == null || !me.host) return;
        String conn = msg.path("conn").asText("");
        switch (msg.path("action").asText("")) {
            case "mute" -> { Peer t = hub == null || find(l, conn) == null ? null : hub.peer(conn); if (t != null) t.send("call.mute", Map.of("code", code)); }
            case "muteAll" -> { for (Part p : l.parts) if (!p.conn.equals(from.id())) { Peer t = hub == null ? null : hub.peer(p.conn); if (t != null) t.send("call.mute", Map.of("code", code)); } }
            case "lowerHand" -> { Part p = find(l, conn); if (p != null) { p.hand = null; broadcast(c, l); } }
            case "remove" -> {
                Part p = find(l, conn);
                if (p == null || p.conn.equals(from.id())) return;
                Peer t = hub == null ? null : hub.peer(conn);
                remove(code, l, conn, true);
                if (t != null) t.send("call.removed", Map.of("code", code));
            }
            case "access" -> {
                c.setAccess(Call.ACCESS_OPEN.equals(msg.path("access").asText()) ? Call.ACCESS_OPEN : Call.ACCESS_HOST);
                calls.save(c);
                broadcast(c, l);
            }
            case "end" -> finish(c, rooms.roomById(c.getRoomId()));
            default -> { }
        }
    }

    // ---------------------------------------------------------------- ciclo de vida

    /** Termina la llamada para todo el mundo. */
    private void finish(Call c, Room room) {
        if (c.isEnded()) return;
        c.end();
        calls.save(c);
        Live l = live.remove(c.getCode());
        if (l != null) {
            sendAll(l, "call.ended", Map.of("code", c.getCode()));
            for (Waiting w : List.copyOf(l.lobby.values())) {
                Peer t = hub == null ? null : hub.peer(w.conn());
                if (t != null) t.send("call.ended", Map.of("code", c.getCode()));
            }
        }
        if (room != null) events.publishEvent(new RoomEvent(room.getId(), "call.ended", Map.of("code", c.getCode())));
        if (c.getConversationId() != null) {
            long mins = Math.max(1, Duration.between(c.getCreatedAt(), c.getEndedAt()).toMinutes());
            try { chat.postCallSystem(c.getConversationId(), "Llamada terminada · " + (mins >= 60 ? (mins / 60) + " h " + (mins % 60) + " min" : mins + " min")); } catch (RuntimeException ignored) { /* extra */ }
        }
    }

    /** La sala se cierra o alguien sale de ella: sus llamadas terminan o dejan de incluirle. */
    @EventListener
    void onRoomEvent(RoomEvent e) {
        if (("room.closed".equals(e.type()) || "room.inactive".equals(e.type()))) {
            for (Call c : calls.findByRoomIdAndEndedAtIsNullOrderByCreatedAtDesc(e.roomId())) finish(c, null);
        } else if ("member.removed".equals(e.type()) && e.data() instanceof Map<?, ?> m && m.get("userId") instanceof UUID u) {
            for (Map.Entry<String, Live> en : live.entrySet()) {
                for (Part p : List.copyOf(en.getValue().parts)) {
                    if (!p.userId.equals(u)) continue;
                    Peer t = hub == null ? null : hub.peer(p.conn);
                    remove(en.getKey(), en.getValue(), p.conn, true);
                    if (t != null) t.send("call.removed", Map.of("code", en.getKey()));
                }
            }
        }
    }

    /** Las llamadas vacías (nadie dentro) durante unos minutos terminan solas. */
    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    void sweep() {
        Instant limit = Instant.now().minus(Duration.ofMinutes(emptyMinutes));
        for (Call c : calls.findByEndedAtIsNull()) {
            Live l = live.get(c.getCode());
            // una llamada programada espera hasta media hora después de su hora de fin prevista
            if (c.getScheduledEnd() != null && c.getScheduledEnd().plus(Duration.ofMinutes(30)).isAfter(Instant.now())) continue;
            boolean empty = l == null ? c.getCreatedAt().isBefore(limit) : l.parts.isEmpty() && (l.emptySince == null ? c.getCreatedAt().isBefore(limit) : l.emptySince.isBefore(limit));
            if (empty) finish(c, rooms.roomById(c.getRoomId()));
        }
    }

    // ---------------------------------------------------------------- utilidades

    private Call open(String code) {
        return calls.findByCode(normalize(code)).filter(x -> !x.isEnded()).orElseThrow(() -> ApiException.notFound("Esa llamada no existe o ya terminó"));
    }

    private boolean isHost(Call c, Room room, UUID userId) {
        return c.getHostId().equals(userId) || (room != null && rooms.canModerate(room, userId, Role.USER));
    }

    private static Part find(Live l, String conn) {
        for (Part p : l.parts) if (p.conn.equals(conn)) return p;
        return null;
    }

    private void sendAll(Live l, String type, Object data) {
        if (hub == null) return;
        for (Part p : l.parts) {
            Peer t = hub.peer(p.conn);
            if (t != null) t.send(type, data);
        }
    }

    private void broadcast(Call c, Live l) {
        if (hub == null) return;
        for (Part p : List.copyOf(l.parts)) {
            Peer t = hub.peer(p.conn);
            if (t != null) t.send("call.state", snapshot(c, l, p));
        }
    }

    private Map<String, Object> snapshot(Call c, Live l, Part forWho) {
        List<Map<String, Object>> parts = new ArrayList<>();
        for (Part p : l.parts) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("conn", p.conn);
            m.put("userId", p.userId);
            m.put("name", p.name);
            m.put("host", p.host);
            m.put("companion", p.companion);
            m.put("mic", p.mic);
            m.put("cam", p.cam);
            m.put("cc", p.cc);
            m.put("screen", p.screen);
            m.put("hand", p.hand);
            parts.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("code", c.getCode());
        out.put("title", c.getTitle());
        out.put("access", c.getAccess());
        out.put("conversationId", c.getConversationId());
        out.put("startedAt", c.getCreatedAt().toEpochMilli());
        out.put("max", maxParticipants);
        out.put("parts", parts);
        List<Map<String, Object>> lobby = new ArrayList<>();
        if (forWho != null && forWho.host) {
            synchronized (l) {
                for (Waiting w : l.lobby.values()) lobby.add(Map.of("conn", w.conn(), "userId", w.userId(), "name", w.name()));
            }
        }
        out.put("lobby", lobby);
        out.put("invited", invited(c, l));
        out.put("invitedKind", c.getEventId() != null ? "event" : "room");
        return out;
    }

    /**
     * Personas invitadas que aún no están dentro: en una llamada de una cita del calendario, quien la creó y sus invitadas; en cualquier
     * otra, las personas de la sala (todas pueden entrar).
     */
    private List<Map<String, Object>> invited(Call c, Live l) {
        List<Map<String, Object>> base = l.invitedBase;
        if (base == null || l.invitedAt.isBefore(Instant.now().minusSeconds(60))) {
            Set<UUID> ids = new LinkedHashSet<>();
            if (c.getEventId() != null) {
                roomItems.findById(c.getEventId()).ifPresent(ev -> {
                    if (ev.getAuthorId() != null) ids.add(ev.getAuthorId());
                    if (ev.getData().get("invitees") instanceof List<?> inv) {
                        for (Object o : inv) {
                            try { ids.add(UUID.fromString(String.valueOf(o))); } catch (IllegalArgumentException ignored) { /* no válido */ }
                        }
                    }
                });
            } else {
                roomMembers.findByRoomId(c.getRoomId()).forEach((m) -> ids.add(m.getUserId()));
            }
            List<Map<String, Object>> out = new ArrayList<>();
            for (var u : users.findAllById(ids)) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("userId", u.getId());
                m.put("name", u.getDisplayName());
                out.add(m);
            }
            out.sort((a, b) -> String.valueOf(a.get("name")).compareToIgnoreCase(String.valueOf(b.get("name"))));
            l.invitedBase = base = out;
            l.invitedAt = Instant.now();
        }
        Set<UUID> in = new java.util.HashSet<>();
        for (Part p : l.parts) in.add(p.userId);
        return base.stream().filter((m) -> !in.contains((UUID) m.get("userId"))).toList();
    }

    private CallDto dto(Call c, Room room) {
        Live l = live.get(c.getCode());
        List<String> people = l == null ? List.of() : l.parts.stream().map(p -> p.name).distinct().toList();
        return new CallDto(c.getCode(), c.getTitle(), c.getAccess(), c.getHostId(), c.getHostName(), room == null ? null : room.getCode(), room == null ? null : room.getName(),
                c.getConversationId(), c.getCreatedAt(), c.getEndedAt(), people, l == null ? 0 : l.parts.size(), maxParticipants, c.getScheduledAt(), c.getScheduledEnd());
    }

    private void error(Peer p, String code, String message) {
        p.send("call.error", Map.of("code", code == null ? "" : code, "message", message));
    }

    private String newCode() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 10; i++) {
            if (i == 3 || i == 7) sb.append('-');
            sb.append(CODE_ALPHABET.charAt(random.nextInt(CODE_ALPHABET.length())));
        }
        return sb.toString();
    }

    /** Admite el código con o sin guiones, en mayúsculas o con espacios. */
    static String normalize(String raw) {
        String s = raw == null ? "" : raw.toLowerCase().replaceAll("[^a-z]", "");
        return s.length() == 10 ? s.substring(0, 3) + "-" + s.substring(3, 7) + "-" + s.substring(7) : (raw == null ? "" : raw.toLowerCase().strip());
    }
}
