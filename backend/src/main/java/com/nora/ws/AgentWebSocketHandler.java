package com.nora.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nora.assist.AssistService;
import com.nora.assist.AssistService.AgentLink;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * Canal del agente de escritorio (/ws/agent). Se autentica con el token que recibió al emparejarse (cabecera Authorization).
 * Servidor → agente: control.start {session, controller}, control.stop, input {t, x, y, …}. Agente → servidor: hello {os, screen, version}, ping.
 */
@Component
public class AgentWebSocketHandler extends TextWebSocketHandler {

    private record Entry(UUID userId, AgentLink link) {}

    private final Map<String, Entry> entries = new ConcurrentHashMap<>();
    private final AssistService assist;
    private final ObjectMapper json;

    public AgentWebSocketHandler(AssistService assist, ObjectMapper json) {
        this.assist = assist;
        this.json = json;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession raw) throws Exception {
        UUID userId = (UUID) raw.getAttributes().get("userId");
        var safe = new ConcurrentWebSocketSessionDecorator(raw, 5_000, 1024 * 1024);
        Map<String, Object> info = new ConcurrentHashMap<>();
        AgentLink link = new AgentLink() {
            @Override public String id() { return raw.getId(); }
            @Override public void send(String payload) {
                try {
                    safe.sendMessage(new TextMessage(payload));
                } catch (Exception e) {
                    try { raw.close(CloseStatus.SERVER_ERROR); } catch (IOException ignored) { /* ya cerrada */ }
                }
            }
            @Override public Map<String, Object> info() { return new LinkedHashMap<>(info); }
        };
        entries.put(raw.getId(), new Entry(userId, link));
        raw.getAttributes().put("info", info);
        assist.agentConnected(userId, link);
    }

    @Override
    @SuppressWarnings("unchecked")
    protected void handleTextMessage(WebSocketSession raw, TextMessage message) throws Exception {
        Entry e = entries.get(raw.getId());
        if (e == null) return;
        JsonNode msg;
        try {
            msg = json.readTree(message.getPayload());
        } catch (IOException ex) {
            return;
        }
        switch (msg.path("type").asText("")) {
            case "ping" -> e.link().send("{\"type\":\"pong\"}");
            case "hello" -> {
                Map<String, Object> info = (Map<String, Object>) raw.getAttributes().get("info");
                info.put("os", trunc(msg.path("os").asText("")));
                info.put("version", trunc(msg.path("version").asText("")));
                info.put("screen", trunc(msg.path("screen").asText("")));
                assist.agentConnected(e.userId(), e.link()); // vuelve a anunciarlo con los datos
            }
            default -> { }
        }
    }

    private static String trunc(String s) { return s.length() > 40 ? s.substring(0, 40) : s; }

    @Override
    public void afterConnectionClosed(WebSocketSession raw, CloseStatus status) {
        Entry e = entries.remove(raw.getId());
        if (e != null) assist.agentGone(e.userId(), raw.getId());
    }
}
