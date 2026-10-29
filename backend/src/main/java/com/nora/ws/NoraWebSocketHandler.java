package com.nora.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nora.collab.CollabWs;
import com.nora.common.ApiException;
import com.nora.room.Room;
import com.nora.room.RoomService;
import com.nora.upload.UploadService;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * Canal en tiempo real. Protocolo JSON {"type": "...", "data": {...}}.
 * Cliente → servidor: join {code}, leave, ping.
 * Servidor → cliente: joined, presence, pong, error y los eventos de sala/usuario (ver {@link RealtimeBroadcaster}).
 */
@Component
public class NoraWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(NoraWebSocketHandler.class);
    private static final int MAX_SESSIONS_PER_USER = 10;
    private static final int MAX_MESSAGES_PER_10S = 60;
    private static final int MAX_DOC_MESSAGES_PER_10S = 1500;

    static final class Conn implements CollabWs.Peer {
        final WebSocketSession session;
        final UUID userId;
        final String displayName;
        volatile UUID roomId;
        long windowStart = System.currentTimeMillis();
        int windowCount;

        Conn(WebSocketSession session, UUID userId, String displayName) {
            this.session = session;
            this.userId = userId;
            this.displayName = displayName;
        }

        @Override public String id() { return session.getId(); }
        @Override public UUID userId() { return userId; }
        @Override public String displayName() { return displayName; }
        @Override public void send(String type, Object data) { owner.send(this, type, data); }
        NoraWebSocketHandler owner;
        long docWindowStart = System.currentTimeMillis();
        int docWindowCount;
    }

    private final Map<String, Conn> conns = new ConcurrentHashMap<>();
    private final ObjectMapper json;
    private final RoomService rooms;
    private final PresenceService presence;
    private final UploadService uploads;
    private final CollabWs collab;

    public NoraWebSocketHandler(ObjectMapper json, @Lazy RoomService rooms, PresenceService presence, @Lazy UploadService uploads, @Lazy CollabWs collab) {
        this.collab = collab;
        this.json = json;
        this.rooms = rooms;
        this.presence = presence;
        this.uploads = uploads;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession raw) throws Exception {
        UUID userId = (UUID) raw.getAttributes().get("userId");
        String name = (String) raw.getAttributes().get("displayName");
        if (conns.values().stream().filter(c -> c.userId.equals(userId)).count() >= MAX_SESSIONS_PER_USER) {
            raw.close(CloseStatus.POLICY_VIOLATION.withReason("Demasiadas conexiones"));
            return;
        }
        // Si un cliente lento no consume, se corta en vez de acumular memoria.
        var safe = new ConcurrentWebSocketSessionDecorator(raw, 10_000, 8 * 1024 * 1024);
        Conn conn = new Conn(safe, userId, name);
        conn.owner = this;
        conns.put(raw.getId(), conn);
    }

    @Override
    protected void handleTextMessage(WebSocketSession raw, TextMessage message) throws Exception {
        Conn conn = conns.get(raw.getId());
        if (conn == null) return;
        long now = System.currentTimeMillis();
        String payload = message.getPayload();
        // Los mensajes de edición (una pulsación de tecla puede generar varios) tienen su propio presupuesto
        boolean docMsg = payload.startsWith("{\"type\":\"doc.");
        if (docMsg) {
            if (now - conn.docWindowStart > 10_000) {
                conn.docWindowStart = now;
                conn.docWindowCount = 0;
            }
            if (++conn.docWindowCount > MAX_DOC_MESSAGES_PER_10S) {
                conn.session.close(CloseStatus.POLICY_VIOLATION.withReason("Demasiados cambios"));
                return;
            }
        } else {
            if (now - conn.windowStart > 10_000) {
                conn.windowStart = now;
                conn.windowCount = 0;
            }
            if (++conn.windowCount > MAX_MESSAGES_PER_10S) {
                conn.session.close(CloseStatus.POLICY_VIOLATION.withReason("Demasiados mensajes"));
                return;
            }
        }
        JsonNode msg;
        try {
            msg = json.readTree(message.getPayload());
        } catch (IOException e) {
            send(conn, "error", Map.of("message", "Mensaje no válido"));
            return;
        }
        switch (msg.path("type").asText("")) {
            case "ping" -> send(conn, "pong", Map.of());
            case "join" -> join(conn, msg.path("code").asText(""));
            case "leave" -> leaveRoom(conn);
            case "upload.progress" -> relayUploadProgress(conn, msg);
            case "doc.join" -> withDoc(conn, msg, id -> collab.join(conn, id));
            case "doc.leave" -> withDoc(conn, msg, id -> collab.leave(conn, id));
            case "doc.update" -> withDoc(conn, msg, id -> collab.update(conn, id, msg.path("update").asText(""), msg.path("ref").asText("")));
            case "doc.awareness" -> withDoc(conn, msg, id -> collab.awareness(conn, id, msg.path("update").asText(""), msg.path("clientId").asLong(0)));
            default -> send(conn, "error", Map.of("message", "Tipo de mensaje desconocido"));
        }
    }

    private void withDoc(Conn conn, JsonNode msg, java.util.function.Consumer<UUID> action) {
        try {
            action.accept(UUID.fromString(msg.path("docId").asText("")));
        } catch (IllegalArgumentException e) {
            send(conn, "error", Map.of("message", "Documento no válido"));
        }
    }

    private void join(Conn conn, String code) {
        try {
            Room room = rooms.requireMember(conn.userId, code);
            if (room.getId().equals(conn.roomId)) {
                send(conn, "joined", Map.of("roomId", room.getId(), "online", presence.onlineUsers(room.getId())));
                return;
            }
            leaveRoom(conn);
            conn.roomId = room.getId();
            boolean first = presence.join(room.getId(), conn.userId, conn.id());
            send(conn, "joined", Map.of("roomId", room.getId(), "online", presence.onlineUsers(room.getId())));
            if (first) {
                sendToRoom(room.getId(), "presence",
                        Map.of("userId", conn.userId, "displayName", conn.displayName, "online", true));
            }
        } catch (ApiException e) {
            send(conn, "error", Map.of("message", e.getMessage(), "status", e.getStatus().value()));
        }
    }

    /** Progreso en vivo de una subida: el cliente lo reporta, el servidor lo valida y lo reparte a la sala. */
    private void relayUploadProgress(Conn conn, JsonNode msg) {
        UUID roomId = conn.roomId;
        if (roomId == null) return;
        try {
            UUID uploadId = UUID.fromString(msg.path("uploadId").asText(""));
            uploads.progressEvent(conn.userId, roomId, uploadId, msg.path("loaded").asLong(0))
                    .ifPresent(data -> sendToRoom(roomId, "upload.progress", data));
        } catch (IllegalArgumentException ignored) {
            // uploadId no válido
        }
    }

    private void leaveRoom(Conn conn) {
        UUID roomId = conn.roomId;
        if (roomId == null) return;
        conn.roomId = null;
        if (presence.leave(roomId, conn.userId, conn.id())) {
            sendToRoom(roomId, "presence",
                    Map.of("userId", conn.userId, "displayName", conn.displayName, "online", false));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession raw, CloseStatus status) {
        Conn conn = conns.remove(raw.getId());
        if (conn != null) {
            collab.leaveAll(conn);
            leaveRoom(conn);
        }
    }

    @Override
    public void handleTransportError(WebSocketSession raw, Throwable ex) {
        log.debug("Error de transporte WS {}: {}", raw.getId(), ex.toString());
    }

    // ---- Envío ----

    void sendToRoom(UUID roomId, String type, Object data) {
        for (Conn c : List.copyOf(conns.values())) {
            if (roomId.equals(c.roomId)) send(c, type, data);
        }
    }

    void sendToUser(UUID userId, String type, Object data) {
        for (Conn c : List.copyOf(conns.values())) {
            if (c.userId.equals(userId)) send(c, type, data);
        }
    }

    /** La sala ya no existe: los clientes dejan de estar "dentro" de ella. */
    void detachRoom(UUID roomId) {
        for (Conn c : conns.values()) {
            if (roomId.equals(c.roomId)) c.roomId = null;
        }
        presence.clearRoom(roomId);
    }

    /** Expulsado de la sala: sus conexiones dejan de estar dentro de ella y de sus documentos abiertos. */
    void evict(UUID roomId, UUID userId) {
        for (Conn c : List.copyOf(conns.values())) {
            if (c.userId.equals(userId) && roomId.equals(c.roomId)) {
                collab.leaveAll(c);
                leaveRoom(c);
            }
        }
    }

    void closeUser(UUID userId) {
        for (Conn c : List.copyOf(conns.values())) {
            if (c.userId.equals(userId)) {
                try {
                    c.session.close(CloseStatus.POLICY_VIOLATION.withReason("Cuenta desactivada"));
                } catch (IOException ignored) {
                    // ya cerrada
                }
            }
        }
    }

    void send(Conn conn, String type, Object data) {
        try {
            conn.session.sendMessage(new TextMessage(json.writeValueAsString(Map.of("type", type, "data", data))));
        } catch (Exception e) {
            log.debug("No se pudo enviar a {}: {}", conn.id(), e.toString());
            try {
                conn.session.close(CloseStatus.SERVER_ERROR);
            } catch (IOException ignored) {
                // ya cerrada
            }
        }
    }
}
