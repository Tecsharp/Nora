package com.nora.library;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.nora.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Bibliotecas de Excalidraw: las del sistema (administrador) y la personal de cada persona en cada sala. */
@Service
public class LibraryService {

    public static final long MAX_ROOM_LIBRARY_BYTES = 100L * 1024 * 1024;
    public static final long MAX_SYSTEM_LIBRARY_BYTES = 30L * 1024 * 1024;
    private static final int MAX_ITEMS = 5000;

    public record Meta(UUID id, String name, int itemCount, long sizeBytes, Instant createdAt) {}
    public record SystemLibrary(UUID id, String name, JsonNode items) {}
    public record RoomLibrary(JsonNode items, long sizeBytes, long maxBytes) {}

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public LibraryService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    // ---- sistema ----

    public List<Meta> systemMetas() {
        return jdbc.query("select id, name, item_count, size_bytes, created_at from system_libraries order by created_at",
                (r, i) -> new Meta(r.getObject(1, UUID.class), r.getString(2), r.getInt(3), r.getLong(4), r.getTimestamp(5).toInstant()));
    }

    public List<SystemLibrary> systemLibraries() {
        return jdbc.query("select id, name, data from system_libraries order by created_at", (r, i) -> {
            try {
                return new SystemLibrary(r.getObject(1, UUID.class), r.getString(2), json.readTree(r.getString(3)));
            } catch (Exception e) {
                return new SystemLibrary(r.getObject(1, UUID.class), r.getString(2), json.createArrayNode());
            }
        });
    }

    /** Valida un archivo .excalidrawlib (formato 2: libraryItems, o el antiguo: library) y lo guarda ya normalizado. */
    public Meta addSystem(UUID adminId, String rawName, byte[] content) {
        if (content.length == 0) throw ApiException.badRequest("El archivo está vacío");
        if (content.length > MAX_SYSTEM_LIBRARY_BYTES) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "La biblioteca no puede pasar de 30 MB");
        JsonNode root;
        try {
            root = json.readTree(content);
        } catch (Exception e) {
            throw ApiException.badRequest("No es un archivo .excalidrawlib válido (JSON incorrecto)");
        }
        JsonNode list = root.isArray() ? root : root.has("libraryItems") ? root.get("libraryItems") : root.get("library");
        if (list == null || !list.isArray() || list.isEmpty()) throw ApiException.badRequest("El archivo no contiene elementos de biblioteca");
        if (list.size() > MAX_ITEMS) throw ApiException.badRequest("Demasiados elementos (máximo " + MAX_ITEMS + ")");
        ArrayNode items = json.createArrayNode();
        long now = Instant.now().toEpochMilli();
        for (JsonNode it : list) {
            JsonNode elements = it.isArray() ? it : it.get("elements");
            if (elements == null || !elements.isArray() || elements.isEmpty()) continue;
            ObjectNode o = json.createObjectNode();
            o.put("id", it.hasNonNull("id") && it.get("id").isTextual() ? it.get("id").asText() : UUID.randomUUID().toString());
            o.put("status", "published");
            o.set("elements", elements);
            o.put("created", it.hasNonNull("created") && it.get("created").isNumber() ? it.get("created").asLong() : now);
            if (it.hasNonNull("name") && it.get("name").isTextual()) o.put("name", it.get("name").asText());
            items.add(o);
        }
        if (items.isEmpty()) throw ApiException.badRequest("El archivo no contiene elementos de biblioteca");
        String data = items.toString();
        String name = cleanName(rawName);
        UUID id = UUID.randomUUID();
        jdbc.update("insert into system_libraries (id, name, item_count, size_bytes, data, created_by, created_at) values (?,?,?,?,?,?,?)",
                id, name, items.size(), data.getBytes(StandardCharsets.UTF_8).length, data, adminId, Timestamp.from(Instant.now()));
        return new Meta(id, name, items.size(), data.length(), Instant.now());
    }

    public void deleteSystem(UUID id) {
        if (jdbc.update("delete from system_libraries where id = ?", id) == 0) throw ApiException.notFound("Biblioteca no encontrada");
    }

    private static String cleanName(String raw) {
        String n = raw == null ? "" : raw.replaceAll("\\.(excalidrawlib|json)$", "").replaceAll("\\p{Cntrl}", "").trim();
        if (n.isEmpty()) n = "Biblioteca";
        return n.substring(0, Math.min(120, n.length()));
    }

    // ---- por sala y persona ----

    public RoomLibrary roomLibrary(UUID roomId, UUID userId) {
        var rows = jdbc.query("select data, size_bytes from board_libraries where room_id = ? and user_id = ?", (r, i) -> {
            try {
                return new RoomLibrary(json.readTree(r.getString(1)), r.getLong(2), MAX_ROOM_LIBRARY_BYTES);
            } catch (Exception e) {
                return new RoomLibrary(json.createArrayNode(), 0, MAX_ROOM_LIBRARY_BYTES);
            }
        }, roomId, userId);
        return rows.isEmpty() ? new RoomLibrary(json.createArrayNode(), 0, MAX_ROOM_LIBRARY_BYTES) : rows.get(0);
    }

    /** Guarda la biblioteca personal (lista de elementos de biblioteca). Máximo 100 MB por persona y sala. */
    public RoomLibrary saveRoomLibrary(UUID roomId, UUID userId, String body) {
        long bytes = body.getBytes(StandardCharsets.UTF_8).length;
        if (bytes > MAX_ROOM_LIBRARY_BYTES) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "Tu biblioteca de esta sala no puede pasar de 100 MB");
        JsonNode items;
        try {
            items = json.readTree(body);
        } catch (Exception e) {
            throw ApiException.badRequest("Biblioteca no válida");
        }
        if (!items.isArray()) throw ApiException.badRequest("Biblioteca no válida");
        jdbc.update("insert into board_libraries (room_id, user_id, data, size_bytes, updated_at) values (?,?,?,?,?) "
                + "on conflict (room_id, user_id) do update set data = excluded.data, size_bytes = excluded.size_bytes, updated_at = excluded.updated_at",
                roomId, userId, body, bytes, Timestamp.from(Instant.now()));
        return new RoomLibrary(json.createArrayNode(), bytes, MAX_ROOM_LIBRARY_BYTES);
    }
}
