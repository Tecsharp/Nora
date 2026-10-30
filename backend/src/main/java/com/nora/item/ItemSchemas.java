package com.nora.item;

import com.nora.common.ApiException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Forma y límites del contenido de cada herramienta. Todo lo que llega del navegador se reconstruye campo a campo (lo que no está aquí se
 * descarta) para que nadie pueda guardar JSON arbitrario ni enorme. Los campos que gestiona el servidor (votos, respuestas a eventos,
 * reacciones…) nunca se aceptan del cliente: se conservan los que ya había.
 */
final class ItemSchemas {

    private ItemSchemas() {}

    static final Set<String> TOOLS = Set.of("task", "poll", "review", "event", "link", "player");

    /** Campos que solo cambia el servidor mediante acciones (votar, reaccionar…). */
    static final Map<String, Set<String>> SERVER_FIELDS = Map.of("poll", Set.of("votes"), "event", Set.of("rsvp"));

    private static final Pattern DATETIME = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$");
    private static final Pattern COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9_-]{1,40}$");

    static Map<String, Object> clean(String tool, Map<String, Object> in, boolean creating) {
        Map<String, Object> d = in == null ? Map.of() : in;
        Map<String, Object> out = new LinkedHashMap<>();
        switch (tool) {
            case "task" -> {
                out.put("title", str(d, "title", 200, true));
                out.put("description", str(d, "description", 5000, false));
                out.put("status", oneOf(d, "status", List.of("todo", "doing", "review", "done"), "todo"));
                out.put("priority", oneOf(d, "priority", List.of("low", "medium", "high"), "medium"));
                String a = opt(d, "assignee", 40);
                out.put("assignee", a == null ? null : uuid(a));
                String due = opt(d, "due", 10);
                out.put("due", due == null ? null : date(due));
                out.put("labels", strings(d, "labels", 8, 24));
                out.put("checklist", checklist(d.get("checklist")));
            }
            case "poll" -> {
                out.put("question", str(d, "question", 300, true));
                out.put("options", options(d.get("options")));
                out.put("multiple", bool(d, "multiple"));
                out.put("anonymous", bool(d, "anonymous"));
                out.put("closed", bool(d, "closed"));
                Double closes = num(d, "closesAt", 0, 4_102_444_800_000.0); // instante de cierre (milisegundos)
                out.put("closesAt", closes == null ? null : closes.longValue());
            }
            case "review" -> {
                out.put("fileId", uuid(str(d, "fileId", 40, true)));
                out.put("fileName", str(d, "fileName", 255, false));
                out.put("text", str(d, "text", 2000, true));
                out.put("t", num(d, "t", 0, 1_000_000));
                out.put("x", num(d, "x", 0, 1));
                out.put("y", num(d, "y", 0, 1));
                out.put("resolved", bool(d, "resolved"));
            }
            case "event" -> {
                out.put("title", str(d, "title", 150, true));
                out.put("description", str(d, "description", 2000, false));
                out.put("location", str(d, "location", 200, false));
                boolean allDay = bool(d, "allDay");
                out.put("allDay", allDay);
                String start = datetime(str(d, "start", 16, true));
                String end = opt(d, "end", 16);
                end = end == null ? start : datetime(end);
                if (end.compareTo(start) < 0) throw ApiException.badRequest("El evento no puede terminar antes de empezar");
                out.put("start", start);
                out.put("end", end);
                String color = opt(d, "color", 7);
                out.put("color", color != null && COLOR.matcher(color).matches() ? color : null);
            }
            case "link" -> {
                out.put("url", url(str(d, "url", 2000, true)));
                out.put("title", str(d, "title", 200, false));
                out.put("description", str(d, "description", 500, false));
                out.put("tags", strings(d, "tags", 6, 24));
                out.put("pinned", bool(d, "pinned"));
            }
            case "player" -> {
                out.put("kind", oneOf(d, "kind", List.of("youtube", "media", "file"), "media"));
                out.put("title", str(d, "title", 200, false));
                String k = (String) out.get("kind");
                if (k.equals("file")) out.put("fileId", uuid(str(d, "fileId", 40, true)));
                else {
                    String u = url(str(d, "url", 2000, true));
                    out.put("url", u);
                    if (k.equals("youtube")) {
                        String id = youtubeId(u);
                        if (id == null) throw ApiException.badRequest("No se reconoce ese enlace de YouTube");
                        out.put("ytId", id);
                    }
                }
            }
            default -> throw ApiException.badRequest("Herramienta desconocida");
        }
        return out;
    }

    // ---- utilidades de validación ----

    private static String str(Map<String, Object> d, String key, int max, boolean required) {
        Object v = d.get(key);
        String s = v instanceof String x ? x.strip() : v == null ? "" : String.valueOf(v).strip();
        if (s.isEmpty() && required) throw ApiException.badRequest("Falta «" + key + "»");
        if (s.length() > max) throw ApiException.badRequest("«" + key + "» es demasiado largo (máximo " + max + " caracteres)");
        return s;
    }

    private static String opt(Map<String, Object> d, String key, int max) {
        Object v = d.get(key);
        if (!(v instanceof String s) || s.isBlank()) return null;
        if (s.length() > max) throw ApiException.badRequest("«" + key + "» no es válido");
        return s.strip();
    }

    private static boolean bool(Map<String, Object> d, String key) { return Boolean.TRUE.equals(d.get(key)); }

    private static Double num(Map<String, Object> d, String key, double min, double max) {
        Object v = d.get(key);
        if (!(v instanceof Number n)) return null;
        double x = n.doubleValue();
        if (Double.isNaN(x) || x < min || x > max) throw ApiException.badRequest("«" + key + "» fuera de rango");
        return x;
    }

    private static String oneOf(Map<String, Object> d, String key, List<String> allowed, String def) {
        Object v = d.get(key);
        if (v == null) return def;
        if (v instanceof String s && allowed.contains(s)) return s;
        throw ApiException.badRequest("«" + key + "» no es válido");
    }

    private static String uuid(String s) {
        try {
            return UUID.fromString(s).toString();
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("Identificador no válido");
        }
    }

    private static String date(String s) {
        try {
            return LocalDate.parse(s).toString();
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("Fecha no válida (usa AAAA-MM-DD)");
        }
    }

    private static String datetime(String s) {
        if (!DATETIME.matcher(s).matches()) throw ApiException.badRequest("Fecha y hora no válidas (usa AAAA-MM-DDThh:mm)");
        try {
            LocalDateTime.parse(s);
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("Fecha y hora no válidas");
        }
        return s;
    }

    private static final Pattern YT_ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");

    /** Identificador de un vídeo de YouTube a partir de su enlace (watch, youtu.be, shorts, embed, live); null si no lo es. */
    static String youtubeId(String url) {
        try {
            java.net.URI u = java.net.URI.create(url);
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase().replaceFirst("^(www\\.|m\\.|music\\.)", "");
            String path = u.getPath() == null ? "" : u.getPath();
            String id = null;
            if (host.equals("youtu.be")) id = path.replaceFirst("^/", "").split("/")[0];
            else if (host.equals("youtube.com") || host.equals("youtube-nocookie.com")) {
                if (path.equals("/watch") && u.getQuery() != null) {
                    for (String kv : u.getQuery().split("&")) if (kv.startsWith("v=")) id = kv.substring(2);
                } else {
                    java.util.regex.Matcher m = Pattern.compile("^/(?:embed|shorts|live|v)/([^/?]+)").matcher(path);
                    if (m.find()) id = m.group(1);
                }
            }
            return id != null && YT_ID.matcher(id).matches() ? id : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static String url(String s) {
        String low = s.toLowerCase();
        if (!(low.startsWith("https://") || low.startsWith("http://"))) throw ApiException.badRequest("El enlace debe empezar por http:// o https://");
        try {
            java.net.URI u = java.net.URI.create(s);
            if (u.getHost() == null) throw new IllegalArgumentException();
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("El enlace no es válido");
        }
        return s;
    }

    private static List<String> strings(Map<String, Object> d, String key, int maxItems, int maxLen) {
        List<String> out = new ArrayList<>();
        if (d.get(key) instanceof List<?> l) {
            for (Object o : l) {
                if (!(o instanceof String s) || s.isBlank()) continue;
                String t = s.strip();
                if (t.length() > maxLen) t = t.substring(0, maxLen);
                if (!out.contains(t)) out.add(t);
                if (out.size() >= maxItems) break;
            }
        }
        return out;
    }

    private static List<Map<String, Object>> checklist(Object o) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (o instanceof List<?> l) {
            for (Object e : l) {
                if (!(e instanceof Map<?, ?> m)) continue;
                Object text = m.get("text");
                if (!(text instanceof String t) || t.isBlank()) continue;
                Object id = m.get("id");
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("id", id instanceof String s && ID.matcher(s).matches() ? s : UUID.randomUUID().toString().substring(0, 8));
                row.put("text", t.strip().length() > 200 ? t.strip().substring(0, 200) : t.strip());
                row.put("done", Boolean.TRUE.equals(m.get("done")));
                out.add(row);
                if (out.size() >= 30) break;
            }
        }
        return out;
    }

    private static List<Map<String, Object>> options(Object o) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (o instanceof List<?> l) {
            for (Object e : l) {
                String text = e instanceof Map<?, ?> m && m.get("text") instanceof String t ? t.strip() : e instanceof String s ? s.strip() : "";
                if (text.isEmpty()) continue;
                Object id = e instanceof Map<?, ?> m ? m.get("id") : null;
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("id", id instanceof String s && ID.matcher(s).matches() ? s : UUID.randomUUID().toString().substring(0, 8));
                row.put("text", text.length() > 120 ? text.substring(0, 120) : text);
                out.add(row);
                if (out.size() >= 10) break;
            }
        }
        if (out.size() < 2) throw ApiException.badRequest("Una votación necesita al menos dos opciones");
        return out;
    }
}
