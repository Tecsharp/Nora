package com.nora.live;

import com.nora.common.ApiException;
import com.nora.item.RoomItem;
import com.nora.item.RoomItemRepository;
import com.nora.ws.RoomEvent;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Estado «en vivo» de las herramientas que se sincronizan entre todas las personas de la sala y no se guardan en la base de datos:
 * el temporizador de Foco y el Reproductor. Vive en memoria (si el servidor se reinicia, vuelve a empezar de cero) y cada cambio se
 * difunde como {@code live.changed {tool, state}}. El servidor es la única fuente de la hora: los clientes calculan lo que falta con
 * {@code endsAt} y la diferencia de reloj que recibe cada uno en {@code serverNow}.
 */
@Service
public class LiveService {

    private static final long IDLE_TTL_MS = 6 * 3600_000L;

    static final class Member {
        final String name;
        String task;
        final long since = System.currentTimeMillis();
        Member(String name, String task) { this.name = name; this.task = task; }
    }

    static final class Focus {
        String mode = "focus"; // focus | short | long
        String status = "idle"; // idle | running | paused
        long endsAt;
        long remainingMs = 25 * 60_000L;
        int focusMin = 25;
        int shortMin = 5;
        int longMin = 15;
        boolean auto;
        int cycle; // pomodoros completados
        final Map<UUID, Member> members = new LinkedHashMap<>();
        Map<String, Object> finished; // último periodo que terminó
        long rev;
        long touched = System.currentTimeMillis();

        long full(String m) { return 60_000L * (m.equals("focus") ? focusMin : m.equals("short") ? shortMin : longMin); }
    }

    /** Lo que suena ahora en el Reproductor. La posición es la de `updatedAt` (hora del servidor); si está sonando, avanza a `rate` por segundo. */
    static final class Player {
        Map<String, Object> item; // {id, kind, url, ytId, fileId, title}
        boolean playing;
        double position;
        double rate = 1;
        long updatedAt = System.currentTimeMillis();
        String by = "";
        long rev;
    }

    private final Map<UUID, Focus> focus = new ConcurrentHashMap<>();
    private final Map<UUID, Player> player = new ConcurrentHashMap<>();
    private final ApplicationEventPublisher events;
    private final RoomItemRepository items;

    public LiveService(ApplicationEventPublisher events, RoomItemRepository items) {
        this.events = events;
        this.items = items;
    }

    // ---------------------------------------------------------------- Foco

    public Map<String, Object> focusState(UUID roomId) {
        Focus f = focus.get(roomId);
        return f == null ? view(new Focus()) : view(f);
    }

    public Map<String, Object> focusAction(UUID roomId, UUID userId, String userName, Map<String, Object> body) {
        String action = String.valueOf(body.getOrDefault("action", ""));
        Focus f = focus.computeIfAbsent(roomId, k -> new Focus());
        synchronized (f) {
            long now = System.currentTimeMillis();
            switch (action) {
                case "start" -> {
                    if (!f.status.equals("running")) {
                        if (f.status.equals("idle")) f.remainingMs = f.full(f.mode);
                        f.status = "running";
                        f.endsAt = now + f.remainingMs;
                        f.finished = null;
                    }
                }
                case "pause" -> {
                    if (f.status.equals("running")) {
                        f.remainingMs = Math.max(0, f.endsAt - now);
                        f.status = "paused";
                    }
                }
                case "reset" -> {
                    f.status = "idle";
                    f.remainingMs = f.full(f.mode);
                    f.finished = null;
                }
                case "mode" -> {
                    String m = String.valueOf(body.getOrDefault("mode", ""));
                    if (!List.of("focus", "short", "long").contains(m)) throw ApiException.badRequest("Modo no válido");
                    f.mode = m;
                    f.status = "idle";
                    f.remainingMs = f.full(m);
                    f.finished = null;
                }
                case "skip" -> advance(f, false);
                case "config" -> {
                    f.focusMin = minutes(body.get("focusMin"), f.focusMin, 1, 180);
                    f.shortMin = minutes(body.get("shortMin"), f.shortMin, 1, 60);
                    f.longMin = minutes(body.get("longMin"), f.longMin, 1, 120);
                    if (body.get("auto") instanceof Boolean b) f.auto = b;
                    if (f.status.equals("idle")) f.remainingMs = f.full(f.mode);
                }
                case "join" -> f.members.put(userId, new Member(userName, task(body.get("task"))));
                case "task" -> {
                    Member m = f.members.get(userId);
                    if (m != null) m.task = task(body.get("task"));
                }
                case "leave" -> f.members.remove(userId);
                default -> throw ApiException.badRequest("Acción no válida");
            }
            return publish(roomId, f);
        }
    }

    // ---------------------------------------------------------------- Reproductor

    public Map<String, Object> playerState(UUID roomId) {
        Player p = player.get(roomId);
        return pview(p == null ? new Player() : p);
    }

    public Map<String, Object> playerAction(UUID roomId, String userName, Map<String, Object> body) {
        String action = String.valueOf(body.getOrDefault("action", ""));
        Player p = player.computeIfAbsent(roomId, k -> new Player());
        synchronized (p) {
            long now = System.currentTimeMillis();
            double current = p.position + (p.playing ? (now - p.updatedAt) / 1000.0 * p.rate : 0);
            switch (action) {
                case "load" -> {
                    p.item = loadItem(roomId, body.get("itemId"));
                    p.position = 0;
                    p.playing = !Boolean.FALSE.equals(body.get("autoplay"));
                }
                case "next" -> {
                    // solo avanza si lo que terminó es lo que sigue sonando (varias personas lo avisan a la vez)
                    if (p.item == null || !String.valueOf(p.item.get("id")).equals(String.valueOf(body.get("from")))) return pview(p);
                    List<RoomItem> queue = items.findOrdered(roomId, "player", PageRequest.of(0, 500));
                    int i = -1;
                    for (int k = 0; k < queue.size(); k++) if (queue.get(k).getId().toString().equals(String.valueOf(p.item.get("id")))) i = k;
                    if (i >= 0 && i + 1 < queue.size()) {
                        p.item = itemView(queue.get(i + 1));
                        p.position = 0;
                        p.playing = true;
                    } else {
                        p.playing = false;
                        p.position = 0;
                    }
                }
                case "play" -> { p.position = pos(body, current); p.playing = p.item != null; }
                case "pause" -> { p.position = pos(body, current); p.playing = false; }
                case "seek" -> p.position = pos(body, current);
                case "rate" -> {
                    p.position = current;
                    double r = body.get("rate") instanceof Number n ? n.doubleValue() : 1;
                    if (r < 0.25 || r > 2) throw ApiException.badRequest("Velocidad no válida");
                    p.rate = r;
                }
                case "clear" -> { p.item = null; p.playing = false; p.position = 0; }
                default -> throw ApiException.badRequest("Acción no válida");
            }
            p.updatedAt = now;
            p.by = userName;
            p.rev++;
            Map<String, Object> v = pview(p);
            events.publishEvent(new RoomEvent(roomId, "live.changed", Map.of("tool", "player", "state", v)));
            return v;
        }
    }

    private Map<String, Object> loadItem(UUID roomId, Object id) {
        try {
            UUID uid = UUID.fromString(String.valueOf(id));
            return items.findByIdAndRoomIdAndTool(uid, roomId, "player").map(LiveService::itemView).orElseThrow(() -> ApiException.notFound("Ese elemento ya no está en la cola"));
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("Elemento no válido");
        }
    }

    private static Map<String, Object> itemView(RoomItem i) {
        Map<String, Object> m = new LinkedHashMap<>(i.getData());
        m.put("id", i.getId().toString());
        return m;
    }

    /** Título de un vídeo de YouTube (oEmbed público). El servidor solo consulta youtube.com; la dirección va como parámetro, nunca como destino. */
    public String youtubeTitle(String url) {
        try {
            java.net.URI u = java.net.URI.create(url);
            String h = u.getHost() == null ? "" : u.getHost().toLowerCase();
            if (!(h.equals("youtu.be") || h.endsWith(".youtube.com") || h.equals("youtube.com"))) return "";
            java.net.http.HttpRequest r = java.net.http.HttpRequest.newBuilder(java.net.URI.create("https://www.youtube.com/oembed?format=json&url=" + java.net.URLEncoder.encode(url, java.nio.charset.StandardCharsets.UTF_8)))
                    .timeout(java.time.Duration.ofSeconds(5)).header("User-Agent", "Nora").GET().build();
            java.net.http.HttpResponse<String> resp = java.net.http.HttpClient.newBuilder().connectTimeout(java.time.Duration.ofSeconds(4)).build().send(r, java.net.http.HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) return "";
            com.fasterxml.jackson.databind.JsonNode n = new com.fasterxml.jackson.databind.ObjectMapper().readTree(resp.body());
            String t = n.path("title").asText("");
            return t.length() > 200 ? t.substring(0, 200) : t;
        } catch (Exception e) {
            return "";
        }
    }

    private static double pos(Map<String, Object> body, double fallback) {
        double v = body.get("position") instanceof Number n ? n.doubleValue() : fallback;
        return Double.isFinite(v) && v >= 0 && v < 1e6 ? v : fallback;
    }

    private static Map<String, Object> pview(Player p) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("item", p.item);
        v.put("playing", p.playing);
        v.put("position", p.position);
        v.put("rate", p.rate);
        v.put("updatedAt", p.updatedAt);
        v.put("by", p.by);
        v.put("rev", p.rev);
        v.put("serverNow", System.currentTimeMillis());
        return v;
    }

    /** Alguien se desconectó de la sala: deja de contar como «enfocado». */
    public void userLeft(UUID roomId, UUID userId) {
        Focus f = focus.get(roomId);
        if (f == null) return;
        synchronized (f) {
            if (f.members.remove(userId) != null) publish(roomId, f);
        }
    }

    @Scheduled(fixedDelay = 1000)
    void tick() {
        long now = System.currentTimeMillis();
        for (Map.Entry<UUID, Focus> e : focus.entrySet()) {
            Focus f = e.getValue();
            synchronized (f) {
                if (f.status.equals("running") && f.endsAt <= now) {
                    advance(f, true);
                    publish(e.getKey(), f);
                } else if (f.status.equals("idle") && f.members.isEmpty() && now - f.touched > IDLE_TTL_MS) {
                    focus.remove(e.getKey());
                }
            }
        }
    }

    /** Pasa al siguiente periodo (foco → descanso corto, o largo cada 4 → foco). */
    private void advance(Focus f, boolean completed) {
        String prev = f.mode;
        if (completed && prev.equals("focus")) f.cycle++;
        f.mode = prev.equals("focus") ? (f.cycle > 0 && f.cycle % 4 == 0 && completed ? "long" : "short") : "focus";
        if (completed) {
            Map<String, Object> fin = new LinkedHashMap<>();
            fin.put("mode", prev);
            fin.put("at", System.currentTimeMillis());
            f.finished = fin;
        }
        f.remainingMs = f.full(f.mode);
        if (completed && f.auto) {
            f.status = "running";
            f.endsAt = System.currentTimeMillis() + f.remainingMs;
        } else {
            f.status = "idle";
        }
    }

    private Map<String, Object> publish(UUID roomId, Focus f) {
        f.rev++;
        f.touched = System.currentTimeMillis();
        Map<String, Object> v = view(f);
        events.publishEvent(new RoomEvent(roomId, "live.changed", Map.of("tool", "focus", "state", v)));
        return v;
    }

    private static Map<String, Object> view(Focus f) {
        long now = System.currentTimeMillis();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("mode", f.mode);
        v.put("status", f.status);
        v.put("endsAt", f.status.equals("running") ? f.endsAt : null);
        v.put("remainingMs", f.status.equals("running") ? Math.max(0, f.endsAt - now) : f.remainingMs);
        v.put("focusMin", f.focusMin);
        v.put("shortMin", f.shortMin);
        v.put("longMin", f.longMin);
        v.put("auto", f.auto);
        v.put("cycle", f.cycle);
        List<Map<String, Object>> members = new ArrayList<>();
        f.members.forEach((id, m) -> members.add(Map.of("userId", id, "name", m.name, "task", m.task, "since", m.since)));
        v.put("members", members);
        v.put("finished", f.finished);
        v.put("rev", f.rev);
        v.put("serverNow", now);
        return v;
    }

    private static int minutes(Object o, int def, int min, int max) {
        if (!(o instanceof Number n)) return def;
        int v = n.intValue();
        if (v < min || v > max) throw ApiException.badRequest("Los minutos deben estar entre " + min + " y " + max);
        return v;
    }

    private static String task(Object o) {
        String s = o instanceof String x ? x.strip() : "";
        return s.length() > 80 ? s.substring(0, 80) : s;
    }
}
