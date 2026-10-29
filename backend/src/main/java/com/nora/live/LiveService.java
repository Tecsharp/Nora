package com.nora.live;

import com.nora.common.ApiException;
import com.nora.ws.RoomEvent;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.context.ApplicationEventPublisher;
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

    private final Map<UUID, Focus> focus = new ConcurrentHashMap<>();
    private final ApplicationEventPublisher events;

    public LiveService(ApplicationEventPublisher events) {
        this.events = events;
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
