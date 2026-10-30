package com.nora.assist;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nora.collab.CollabWs.Peer;
import com.nora.config.AppProperties;
import com.nora.user.User;
import com.nora.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Asistencia remota entre personas de una sala.
 *
 * <p>Ver la pantalla: el vídeo viaja directo entre los dos navegadores (WebRTC); aquí solo se hace de «teléfono» (señalización) y se
 * comprueba que ambos estén en la misma sala y que quien comparte lo haya aceptado.
 *
 * <p>Controlar: un navegador no puede mover el ratón de un equipo, así que quien comparte instala el agente de Nora (un programa pequeño
 * que se empareja con su cuenta). Cuando comparte acepta expresamente el control, el servidor reenvía al agente los clics y las
 * teclas de la otra persona, y solo mientras ese permiso esté activo.
 *
 * <pre>
 * cliente → servidor                                   servidor → cliente
 *   assist.request {to, mode}                            assist.request {session, from, mode}   (a quien comparte)
 *   assist.invite  {to}                                  assist.invite  {session, from}         (a quien verá)
 *   assist.respond {session, accept}                     assist.pending / assist.declined / assist.taken
 *   assist.signal  {session, payload}                    assist.started {session, role, peer, mode}
 *   assist.control {session, action}                     assist.signal  {session, payload}
 *   assist.input   {session, e}                          assist.control {session, action, controller}
 *   assist.end     {session}                             assist.ended   {session, reason}
 *                                                        assist.agent   {online}
 * </pre>
 */
@Service
public class AssistService {

    /** Quién está conectado y en qué sala; lo implementa el manejador del WebSocket. */
    public interface Hub {
        List<Peer> peers(UUID roomId, UUID userId);
        List<Peer> userPeers(UUID userId);
        /** Todas las pestañas que están en alguna de las salas donde esa persona está conectada. */
        List<Peer> roomMates(UUID userId);
        Peer peer(String id);
    }

    private static final int MAX_SESSIONS_PER_USER = 6;
    private static final Duration PENDING_TTL = Duration.ofMinutes(2);
    private static final Duration PAIR_TTL = Duration.ofMinutes(10);
    private static final Duration AGENT_TOKEN_TTL = Duration.ofDays(90);
    private static final String CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static final Set<String> INPUT_TYPES = Set.of("mm", "md", "mu", "wh", "kd", "ku");

    enum State { PENDING, ACTIVE }

    static final class Session {
        final String id = UUID.randomUUID().toString();
        final UUID roomId;
        final UUID viewerId;
        final UUID sharerId;
        final UUID initiatorId;
        final String initiatorConn;
        volatile String mode = "view";
        final Instant created = Instant.now();
        volatile State state = State.PENDING;
        volatile String viewerConn;
        volatile String sharerConn;
        volatile boolean control;
        volatile boolean controlAsked;

        Session(UUID roomId, UUID viewerId, UUID sharerId, UUID initiatorId, String initiatorConn) {
            this.roomId = roomId;
            this.viewerId = viewerId;
            this.sharerId = sharerId;
            this.initiatorId = initiatorId;
            this.initiatorConn = initiatorConn;
        }

        boolean involves(UUID userId) { return viewerId.equals(userId) || sharerId.equals(userId); }
    }

    private record Pair(UUID userId, Instant expires) {}

    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private final Map<String, Pair> pairCodes = new ConcurrentHashMap<>();
    private final Map<UUID, Map<String, AgentLink>> agents = new ConcurrentHashMap<>();
    private final ObjectMapper json;
    private final UserRepository users;
    private final SecretKeySpec agentKey;
    private final SecureRandom random = new SecureRandom();
    private final String stunUrls;
    private final String turnUrls;
    private final String turnSecret;
    private volatile Hub hub;
    private volatile long pairWindow = System.currentTimeMillis();
    private volatile int pairFailures;

    /** Una conexión del agente de escritorio. */
    public interface AgentLink {
        String id();
        void send(String json);
        Map<String, Object> info();
    }

    public AssistService(ObjectMapper json, UserRepository users, AppProperties props,
                         @Value("${NORA_STUN_URLS:stun:stun.l.google.com:19302}") String stunUrls,
                         @Value("${NORA_TURN_URLS:}") String turnUrls,
                         @Value("${NORA_TURN_SECRET:}") String turnSecret) {
        this.json = json;
        this.users = users;
        this.agentKey = new SecretKeySpec((props.jwt().secret() + "|nora-agent").getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        this.stunUrls = stunUrls;
        this.turnUrls = turnUrls;
        this.turnSecret = turnSecret;
    }

    public void setHub(Hub hub) { this.hub = hub; }

    // ---------------------------------------------------------------- ICE (STUN/TURN)

    /** Servidores para que los navegadores se encuentren; con TURN configurado, credenciales efímeras (coturn use-auth-secret). */
    public List<Map<String, Object>> iceServers(UUID userId) {
        List<Map<String, Object>> out = new ArrayList<>();
        List<String> stun = split(stunUrls);
        if (!stun.isEmpty()) out.add(Map.of("urls", stun));
        List<String> turn = split(turnUrls);
        if (!turn.isEmpty() && !turnSecret.isBlank()) {
            long expires = Instant.now().plusSeconds(6 * 3600).getEpochSecond();
            String username = expires + ":" + userId;
            out.add(Map.of("urls", turn, "username", username, "credential", hmacBase64(turnSecret.getBytes(StandardCharsets.UTF_8), username, "HmacSHA1")));
        }
        return out;
    }

    private static List<String> split(String s) {
        return s == null ? List.of() : java.util.Arrays.stream(s.split("[,\\s]+")).filter(x -> !x.isBlank()).toList();
    }

    private static String hmacBase64(byte[] key, String data, String alg) {
        try {
            Mac mac = Mac.getInstance(alg);
            mac.init(new SecretKeySpec(key, alg));
            return Base64.getEncoder().encodeToString(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // ---------------------------------------------------------------- Emparejar el agente

    /** Código corto de un solo uso (10 min) que la persona escribe en el agente para vincularlo a su cuenta. */
    public String newPairCode(UUID userId) {
        purge();
        pairCodes.values().removeIf(p -> p.userId().equals(userId)); // un solo código vigente por persona
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 8; i++) sb.append(CODE_ALPHABET.charAt(random.nextInt(CODE_ALPHABET.length())));
        String code = sb.toString();
        pairCodes.put(code, new Pair(userId, Instant.now().plus(PAIR_TTL)));
        return code.substring(0, 4) + "-" + code.substring(4);
    }

    /** Canjea el código por el token del agente. Limita los intentos fallidos para que no se pueda adivinar. */
    public Optional<String> pair(String rawCode) {
        long now = System.currentTimeMillis();
        synchronized (this) {
            if (now - pairWindow > 60_000) {
                pairWindow = now;
                pairFailures = 0;
            }
            if (pairFailures >= 20) return Optional.empty();
        }
        String code = rawCode == null ? "" : rawCode.replaceAll("[^A-Za-z0-9]", "").toUpperCase();
        Pair p = code.length() == 8 ? pairCodes.remove(code) : null;
        if (p == null || p.expires().isBefore(Instant.now())) {
            synchronized (this) { pairFailures++; }
            return Optional.empty();
        }
        return Optional.of(agentToken(p.userId()));
    }

    private String agentToken(UUID userId) {
        String body = userId + "." + Instant.now().getEpochSecond();
        return Base64.getUrlEncoder().withoutPadding().encodeToString(body.getBytes(StandardCharsets.UTF_8)) + "." + hmacBase64(agentKey.getEncoded(), body, "HmacSHA256").replace('+', '-').replace('/', '_').replace("=", "");
    }

    /** Persona dueña del token, si es válido, no ha caducado y la cuenta sigue activa y sin cierre de sesiones posterior. */
    public Optional<User> userForAgentToken(String token) {
        try {
            if (token == null) return Optional.empty();
            int dot = token.indexOf('.');
            if (dot < 1) return Optional.empty();
            String body = new String(Base64.getUrlDecoder().decode(token.substring(0, dot)), StandardCharsets.UTF_8);
            String expected = hmacBase64(agentKey.getEncoded(), body, "HmacSHA256").replace('+', '-').replace('/', '_').replace("=", "");
            if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), token.substring(dot + 1).getBytes(StandardCharsets.UTF_8))) return Optional.empty();
            String[] parts = body.split("\\.");
            Instant issued = Instant.ofEpochSecond(Long.parseLong(parts[1]));
            if (issued.plus(AGENT_TOKEN_TTL).isBefore(Instant.now())) return Optional.empty();
            return users.findById(UUID.fromString(parts[0])).filter(User::isEnabled)
                    .filter(u -> u.getTokensValidAfter() == null || !issued.isBefore(u.getTokensValidAfter().truncatedTo(java.time.temporal.ChronoUnit.SECONDS)));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    // ---------------------------------------------------------------- Agentes conectados

    public void agentConnected(UUID userId, AgentLink link) {
        agents.computeIfAbsent(userId, k -> new ConcurrentHashMap<>()).put(link.id(), link);
        announceAgent(userId);
        // si ya hay un control en marcha (el agente se reconectó), se le avisa
        for (Session s : sessions.values()) {
            if (s.control && s.sharerId.equals(userId)) link.send(controlStartJson(s));
        }
    }

    public void agentGone(UUID userId, String linkId) {
        Map<String, AgentLink> m = agents.get(userId);
        if (m == null) return;
        m.remove(linkId);
        if (m.isEmpty()) agents.remove(userId);
        if (!agents.containsKey(userId)) {
            for (Session s : List.copyOf(sessions.values())) {
                if (s.control && s.sharerId.equals(userId)) revokeControl(s, "El agente de Nora se desconectó");
            }
        }
        announceAgent(userId);
    }

    /** La persona detuvo el control desde su agente (panel o icono): se corta en todas sus sesiones y se avisa a quien controlaba. */
    public void agentRevoke(UUID userId) {
        for (Session s : List.copyOf(sessions.values())) {
            if (s.sharerId.equals(userId)) revokeControl(s, "Se quitó el control desde el agente");
        }
    }

    public boolean agentOnline(UUID userId) { return agents.containsKey(userId); }

    public Map<String, Object> agentInfo(UUID userId) {
        Map<String, AgentLink> m = agents.get(userId);
        if (m == null || m.isEmpty()) return Map.of("online", false);
        Map<String, Object> out = new LinkedHashMap<>(m.values().iterator().next().info());
        out.put("online", true);
        return out;
    }

    private void announceAgent(UUID userId) {
        if (hub == null) return;
        Map<String, Object> info = agentInfo(userId);
        for (Peer p : hub.userPeers(userId)) p.send("assist.agent", info);
        // quienes comparten sala con esta persona saben si se le puede pedir control
        Map<String, Object> ev = Map.of("userId", userId, "online", agentOnline(userId));
        for (Peer p : hub.roomMates(userId)) p.send("assist.agent.user", ev);
    }

    private void toAgents(UUID userId, String payload) {
        Map<String, AgentLink> m = agents.get(userId);
        if (m != null) m.values().forEach(a -> a.send(payload));
    }

    private String controlStartJson(Session s) {
        String name = hub != null && hub.peer(s.viewerConn) != null ? hub.peer(s.viewerConn).displayName() : "";
        try {
            return json.writeValueAsString(Map.of("type", "control.start", "session", s.id, "controller", name));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // ---------------------------------------------------------------- Mensajes del navegador

    public void request(Peer from, UUID roomId, JsonNode msg) {
        UUID to = uuid(msg.path("to").asText(""));
        String mode = "control".equals(msg.path("mode").asText("")) ? "control" : "view";
        if (to == null || to.equals(from.userId())) { error(from, "Elige a otra persona de la sala"); return; }
        List<Peer> targets = hub.peers(roomId, to);
        if (targets.isEmpty()) { error(from, "Esa persona no está conectada a la sala ahora mismo"); return; }
        if (mode.equals("control") && !agentOnline(to)) { error(from, "Esa persona no tiene el agente de Nora conectado, así que no se puede controlar su equipo (sí ver su pantalla)"); return; }
        if (tooMany(from.userId()) || tooMany(to)) { error(from, "Ya hay demasiadas sesiones de asistencia abiertas"); return; }
        Session s = new Session(roomId, from.userId(), to, from.userId(), from.id());
        s.viewerConn = from.id();
        s.mode = mode;
        sessions.put(s.id, s);
        Map<String, Object> req = Map.of("session", s.id, "from", person(from), "mode", mode);
        targets.forEach(p -> p.send("assist.request", req));
        from.send("assist.pending", Map.of("session", s.id, "mode", mode));
    }

    public void invite(Peer from, UUID roomId, JsonNode msg) {
        UUID to = uuid(msg.path("to").asText(""));
        if (to == null || to.equals(from.userId())) { error(from, "Elige a otra persona de la sala"); return; }
        List<Peer> targets = hub.peers(roomId, to);
        if (targets.isEmpty()) { error(from, "Esa persona no está conectada a la sala ahora mismo"); return; }
        if (tooMany(from.userId()) || tooMany(to)) { error(from, "Ya hay demasiadas sesiones de asistencia abiertas"); return; }
        Session s = new Session(roomId, to, from.userId(), from.userId(), from.id());
        s.sharerConn = from.id();
        sessions.put(s.id, s);
        Map<String, Object> inv = Map.of("session", s.id, "from", person(from));
        targets.forEach(p -> p.send("assist.invite", inv));
        from.send("assist.pending", Map.of("session", s.id, "mode", "view"));
    }

    /** Respuesta de quien recibió la petición (o la invitación). */
    public void respond(Peer from, JsonNode msg) {
        Session s = sessions.get(msg.path("session").asText(""));
        if (s == null || s.state != State.PENDING) { error(from, "Esa solicitud ya no está disponible"); return; }
        boolean sharerAnswers = s.initiatorId.equals(s.viewerId); // pidió ver: contesta quien comparte
        UUID answerer = sharerAnswers ? s.sharerId : s.viewerId;
        if (!from.userId().equals(answerer)) return;
        Peer initiator = hub.peer(s.initiatorConn);
        if (!msg.path("accept").asBoolean(false)) {
            sessions.remove(s.id);
            if (initiator != null) initiator.send("assist.declined", Map.of("session", s.id, "by", from.displayName()));
            hub.peers(s.roomId, answerer).stream().filter(p -> !p.id().equals(from.id())).forEach(p -> p.send("assist.taken", Map.of("session", s.id)));
            return;
        }
        if (initiator == null) {
            sessions.remove(s.id);
            { error(from, "Quien lo pidió ya se desconectó"); return; }
        }
        if (sharerAnswers) s.sharerConn = from.id(); else s.viewerConn = from.id();
        s.state = State.ACTIVE;
        hub.peers(s.roomId, answerer).stream().filter(p -> !p.id().equals(from.id())).forEach(p -> p.send("assist.taken", Map.of("session", s.id)));
        Peer viewer = hub.peer(s.viewerConn);
        Peer sharer = hub.peer(s.sharerConn);
        if (viewer == null || sharer == null) {
            end(s, "La otra persona se desconectó");
            return;
        }
        boolean control = "control".equals(s.mode);
        viewer.send("assist.started", Map.of("session", s.id, "role", "viewer", "peer", person(sharer), "mode", control ? "control" : "view"));
        sharer.send("assist.started", Map.of("session", s.id, "role", "sharer", "peer", person(viewer), "mode", control ? "control" : "view"));
    }

    public void signal(Peer from, JsonNode msg) {
        Session s = active(from, msg);
        if (s == null) return;
        JsonNode payload = msg.path("payload");
        if (!payload.isObject() || payload.toString().length() > 64 * 1024) return;
        Peer other = otherSide(s, from);
        if (other != null) other.send("assist.signal", Map.of("session", s.id, "payload", payload));
    }

    public void control(Peer from, JsonNode msg) {
        Session s = active(from, msg);
        if (s == null) return;
        String action = msg.path("action").asText("");
        boolean isViewer = from.id().equals(s.viewerConn);
        Peer other = otherSide(s, from);
        switch (action) {
            case "request" -> {
                if (!isViewer) return;
                if (!agentOnline(s.sharerId)) { error(from, "Esa persona no tiene el agente de Nora conectado"); return; }
                s.controlAsked = true;
                if (other != null) other.send("assist.control", Map.of("session", s.id, "action", "request", "controller", from.displayName()));
            }
            case "grant" -> {
                if (isViewer || !s.controlAsked) return;
                if (!agentOnline(s.sharerId)) { error(from, "Tu agente de Nora no está conectado"); return; }
                s.control = true;
                s.controlAsked = false;
                toAgents(s.sharerId, controlStartJson(s));
                if (other != null) other.send("assist.control", Map.of("session", s.id, "action", "granted"));
                from.send("assist.control", Map.of("session", s.id, "action", "granted", "controller", other == null ? "" : other.displayName()));
            }
            case "deny" -> {
                if (isViewer) return;
                s.controlAsked = false;
                if (other != null) other.send("assist.control", Map.of("session", s.id, "action", "denied"));
            }
            case "revoke" -> revokeControl(s, isViewer ? "La otra persona dejó de controlar" : "Se quitó el control");
            default -> { }
        }
    }

    /** Un clic o una tecla de quien controla, reenviados al agente de quien comparte (solo con el control concedido). */
    public void input(Peer from, JsonNode msg) {
        Session s = sessions.get(msg.path("session").asText(""));
        if (s == null || !s.control || !from.id().equals(s.viewerConn)) return;
        JsonNode e = msg.path("e");
        String t = e.path("t").asText("");
        if (!INPUT_TYPES.contains(t)) return;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", "input");
        out.put("t", t);
        for (String f : List.of("x", "y", "dx", "dy")) if (e.path(f).isNumber()) out.put(f, e.path(f).asDouble());
        if (e.path("b").isInt()) out.put("b", e.path("b").asInt());
        for (String f : List.of("k", "c")) if (e.path(f).isTextual() && e.path(f).asText().length() <= 32) out.put(f, e.path(f).asText());
        try {
            toAgents(s.sharerId, json.writeValueAsString(out));
        } catch (Exception ignored) {
            // no se pudo serializar: se descarta
        }
    }

    public void end(Peer from, JsonNode msg) {
        Session s = sessions.get(msg.path("session").asText(""));
        if (s == null || !s.involves(from.userId())) return;
        end(s, from.displayName() + " terminó la asistencia");
    }

    // ---------------------------------------------------------------- Ciclo de vida

    private void end(Session s, String reason) {
        if (sessions.remove(s.id) == null) return;
        if (s.control) toAgents(s.sharerId, "{\"type\":\"control.stop\"}");
        s.control = false;
        Map<String, Object> ev = Map.of("session", s.id, "reason", reason);
        for (String conn : new String[] {s.viewerConn, s.sharerConn, s.initiatorConn}) {
            Peer p = conn == null || hub == null ? null : hub.peer(conn);
            if (p != null) p.send("assist.ended", ev);
        }
    }

    private void revokeControl(Session s, String reason) {
        boolean was = s.control || s.controlAsked;
        s.control = false;
        s.controlAsked = false;
        if (!was) return;
        toAgents(s.sharerId, "{\"type\":\"control.stop\"}");
        for (String conn : new String[] {s.viewerConn, s.sharerConn}) {
            Peer p = conn == null || hub == null ? null : hub.peer(conn);
            if (p != null) p.send("assist.control", Map.of("session", s.id, "action", "revoked", "reason", reason));
        }
    }

    /** Se cerró una pestaña: terminan las sesiones que dependían de ella. */
    public void peerGone(Peer p) {
        for (Session s : List.copyOf(sessions.values())) {
            if (p.id().equals(s.viewerConn) || p.id().equals(s.sharerConn) || (s.state == State.PENDING && p.id().equals(s.initiatorConn))) {
                end(s, p.displayName() + " se desconectó");
            }
        }
    }

    /** Salió de la sala (o lo expulsaron): también terminan sus sesiones en ella. */
    public void userLeftRoom(UUID roomId, UUID userId) {
        for (Session s : List.copyOf(sessions.values())) {
            if (s.roomId.equals(roomId) && s.involves(userId)) end(s, "La otra persona salió de la sala");
        }
    }

    @Scheduled(fixedDelay = 30_000)
    void purge() {
        Instant now = Instant.now();
        pairCodes.values().removeIf(p -> p.expires().isBefore(now));
        for (Session s : List.copyOf(sessions.values())) {
            if (s.state == State.PENDING && s.created.plus(PENDING_TTL).isBefore(now)) {
                sessions.remove(s.id);
                Peer p = hub == null ? null : hub.peer(s.initiatorConn);
                if (p != null) p.send("assist.declined", Map.of("session", s.id, "by", ""));
            }
        }
    }

    // ---------------------------------------------------------------- utilidades

    private Session active(Peer from, JsonNode msg) {
        Session s = sessions.get(msg.path("session").asText(""));
        if (s == null || s.state != State.ACTIVE) return null;
        return from.id().equals(s.viewerConn) || from.id().equals(s.sharerConn) ? s : null;
    }

    private Peer otherSide(Session s, Peer from) {
        String other = from.id().equals(s.viewerConn) ? s.sharerConn : s.viewerConn;
        return other == null || hub == null ? null : hub.peer(other);
    }

    private boolean tooMany(UUID userId) {
        return sessions.values().stream().filter(s -> s.involves(userId)).count() >= MAX_SESSIONS_PER_USER;
    }

    private static Map<String, Object> person(Peer p) {
        return Map.of("id", p.userId(), "name", p.displayName());
    }

    private static void error(Peer to, String message) {
        to.send("assist.error", Map.of("message", message));
    }

    private static UUID uuid(String s) {
        try {
            return UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
