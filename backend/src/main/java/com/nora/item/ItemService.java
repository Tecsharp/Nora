package com.nora.item;

import com.nora.auth.AuthPrincipal;
import com.nora.common.ApiException;
import com.nora.file.RoomFileRepository;
import com.nora.notify.NotificationService;
import com.nora.room.Room;
import com.nora.room.RoomService;
import com.nora.user.UserRepository;
import com.nora.ws.RoomEvent;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Elementos de las herramientas de la sala (Chat, Tablero, Votaciones, Media Review, Calendario, Enlaces, Reproductor).
 * Permisos: ver y reaccionar/votar lo puede cualquier participante; crear y editar, quien pueda escribir (no lectores);
 * editar o borrar lo de otras personas solo quien modera, salvo las tareas, que todo el que escribe puede mover y completar.
 * Cada cambio se reparte a la sala como {@code item.changed {tool, op, item}}.
 */
@Service
public class ItemService {

    public record ItemDto(UUID id, String tool, UUID authorId, String authorName, Map<String, Object> data, double sort, Instant createdAt, Instant updatedAt) {}

    private static final Set<String> EDIT_ANY = Set.of("task"); // todo el que escribe puede editarlas (mover entre columnas, asignar…)
    private static final int MAX_PER_TOOL = 5000;
    private static final Set<String> RSVP = Set.of("yes", "no", "maybe", "none");

    private final RoomItemRepository items;
    private final RoomService rooms;
    private final UserRepository users;
    private final ApplicationEventPublisher events;
    private final NotificationService notifications;
    private final RoomFileRepository files;

    public ItemService(RoomItemRepository items, RoomService rooms, UserRepository users, ApplicationEventPublisher events, NotificationService notifications, RoomFileRepository files) {
        this.notifications = notifications;
        this.files = files;
        this.items = items;
        this.rooms = rooms;
        this.users = users;
        this.events = events;
    }

    private static String tool(String t) {
        if (!ItemSchemas.TOOLS.contains(t)) throw ApiException.notFound("Herramienta desconocida");
        return t;
    }

    @Transactional(readOnly = true)
    public List<ItemDto> list(AuthPrincipal p, String code, String tool, Instant before, int limit) {
        tool(tool);
        Room room = rooms.requireMember(p.userId(), code);
        int n = Math.max(1, Math.min(limit, 500));
        List<RoomItem> found = items.findOrdered(room.getId(), tool, PageRequest.of(0, Math.min(n * 4, 2000)));
        return found.stream().map(i -> view(i, p.userId())).toList();
    }

    @Transactional
    public ItemDto create(AuthPrincipal p, String code, String tool, Map<String, Object> data, Double sort) {
        tool(tool);
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        if (items.countByRoomIdAndTool(room.getId(), tool) >= MAX_PER_TOOL) throw ApiException.conflict("Se alcanzó el máximo de elementos de esta herramienta en la sala");
        Map<String, Object> clean = ItemSchemas.clean(tool, data, true);
        checkRefs(room, tool, clean);
        RoomItem it = new RoomItem(room.getId(), tool, p.userId(), users.findById(p.userId()).orElseThrow().getDisplayName(), clean,
                sort != null && Double.isFinite(sort) ? sort : System.currentTimeMillis());
        items.save(it);
        notifyCreated(room, it, p.userId());
        return publish(it, "created", p.userId());
    }

    @Transactional
    public ItemDto update(AuthPrincipal p, String code, String tool, UUID id, Map<String, Object> data, Double sort) {
        tool(tool);
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        RoomItem it = items.lockById(id, room.getId(), tool).orElseThrow(() -> ApiException.notFound("Ese elemento ya no existe"));
        requireCanEdit(room, p, it);
        Object prevAssignee = it.getData().get("assignee");
        if (data != null) {
            Map<String, Object> clean = ItemSchemas.clean(tool, data, false);
            checkRefs(room, tool, clean);
            // lo que gestiona el servidor (votos, respuestas, reacciones) se conserva
            for (String f : ItemSchemas.SERVER_FIELDS.getOrDefault(tool, Set.of())) if (it.getData().containsKey(f)) clean.put(f, it.getData().get(f));
            if ("poll".equals(tool)) dropOrphanVotes(clean);
            it.setData(clean);
        }
        if (sort != null && Double.isFinite(sort)) it.setSort(sort);
        items.save(it);
        if ("task".equals(tool) && it.getData().get("assignee") instanceof String a && !a.equals(prevAssignee)) notifyAssigned(room, it, a, p.userId());
        return publish(it, "updated", p.userId());
    }

    @Transactional
    public void delete(AuthPrincipal p, String code, String tool, UUID id) {
        tool(tool);
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        RoomItem it = items.findByIdAndRoomIdAndTool(id, room.getId(), tool).orElseThrow(() -> ApiException.notFound("Ese elemento ya no existe"));
        if (!isAuthor(p, it) && !rooms.canModerate(room, p.userId(), p.role())) throw ApiException.forbidden("Solo quien lo creó o quien modera puede borrarlo");
        items.delete(it);
        events.publishEvent(new RoomEvent(room.getId(), "item.changed", Map.of("tool", tool, "op", "deleted", "item", Map.of("id", id))));
    }

    /** Acciones que cambian solo una parte (votar, reaccionar…) y se hacen con cerrojo para no pisarse. */
    @Transactional
    public ItemDto act(AuthPrincipal p, String code, String tool, UUID id, String action, Map<String, Object> body) {
        tool(tool);
        Room room = rooms.requireMember(p.userId(), code);
        RoomItem it = items.lockById(id, room.getId(), tool).orElseThrow(() -> ApiException.notFound("Ese elemento ya no existe"));
        Map<String, Object> d = new LinkedHashMap<>(it.getData());
        String me = p.userId().toString();
        boolean writer = rooms.canWrite(room, p.userId(), p.role());
        switch (tool + "." + action) {
            case "poll.vote" -> {
                if (Boolean.TRUE.equals(d.get("closed"))) throw ApiException.conflict("La votación está cerrada");
                if (d.get("closesAt") instanceof Number c && c.longValue() <= System.currentTimeMillis()) throw ApiException.conflict("La votación ya cerró");
                List<String> chosen = body.get("options") instanceof List<?> l ? l.stream().filter(String.class::isInstance).map(String.class::cast).distinct().toList() : List.of();
                Set<String> valid = new java.util.HashSet<>();
                for (Object o : (List<?>) d.get("options")) valid.add(String.valueOf(((Map<?, ?>) o).get("id")));
                if (!valid.containsAll(chosen)) throw ApiException.badRequest("Opción no válida");
                if (!Boolean.TRUE.equals(d.get("multiple")) && chosen.size() > 1) throw ApiException.badRequest("Solo se puede elegir una opción");
                Map<String, Object> votes = new LinkedHashMap<>(votesOf(d));
                if (chosen.isEmpty()) votes.remove(me);
                else votes.put(me, chosen);
                d.put("votes", votes);
            }
            case "event.rsvp" -> {
                String st = body.get("status") instanceof String s ? s : "";
                if (!RSVP.contains(st)) throw ApiException.badRequest("Respuesta no válida");
                Map<String, Object> r = new LinkedHashMap<>(d.get("rsvp") instanceof Map<?, ?> m ? castMap(m) : Map.of());
                if (st.equals("none")) r.remove(me);
                else r.put(me, st);
                d.put("rsvp", r);
            }
            case "review.resolve" -> {
                if (!writer) throw ApiException.forbidden("Tu rol en esta sala es de solo lectura");
                d.put("resolved", Boolean.TRUE.equals(body.get("resolved")));
            }
            case "link.pin" -> {
                if (!writer) throw ApiException.forbidden("Tu rol en esta sala es de solo lectura");
                d.put("pinned", Boolean.TRUE.equals(body.get("pinned")));
            }
            default -> throw ApiException.badRequest("Acción no válida");
        }
        it.setData(d);
        items.save(it);
        return publish(it, "updated", p.userId());
    }

    // ---- avisos ----

    private void notifyCreated(Room room, RoomItem it, UUID actor) {
        String who = it.getAuthorName();
        Map<String, Object> d = it.getData();
        switch (it.getTool()) {
            case "task" -> {
                if (d.get("assignee") instanceof String a) notifyAssigned(room, it, a, actor);
            }
            case "poll" -> notifications.notifyRoom(room, actor, "poll", who + " creó una votación", String.valueOf(d.get("question")),
                    link("polls", it.getId()), null);
            case "event" -> notifications.notifyRoom(room, actor, "event", who + " agendó un evento", eventLine(d), link("calendar", it.getId()), null);
            case "review" -> {
                UUID file = UUID.fromString(String.valueOf(d.get("fileId")));
                Map<String, Object> l = link("media", it.getId());
                l.put("file", file.toString());
                String name = d.get("fileName") instanceof String n && !n.isBlank() ? n : "un archivo";
                files.findById(file).filter(f -> !f.getUploaderId().equals(actor)).ifPresent(f ->
                        notifications.notify(f.getUploaderId(), room, "review", who + " comentó " + name, String.valueOf(d.get("text")), l, null));
            }
            default -> { }
        }
    }

    private void notifyAssigned(Room room, RoomItem it, String assignee, UUID actor) {
        UUID to = UUID.fromString(assignee);
        if (to.equals(actor)) return;
        String who = users.findById(actor).map(u -> u.getDisplayName()).orElse("Alguien");
        notifications.notify(to, room, "task", who + " te asignó una tarea", String.valueOf(it.getData().get("title")), link("actions", it.getId()), null);
    }

    private static String eventLine(Map<String, Object> d) {
        String start = String.valueOf(d.get("start")).replace('T', ' ');
        return d.get("title") + " · " + start;
    }

    private static Map<String, Object> link(String tool, UUID item) {
        Map<String, Object> l = new LinkedHashMap<>();
        l.put("tool", tool);
        l.put("item", item.toString());
        return l;
    }

    // ---- reglas ----

    private void requireCanEdit(Room room, AuthPrincipal p, RoomItem it) {
        if (EDIT_ANY.contains(it.getTool()) || isAuthor(p, it) || rooms.canModerate(room, p.userId(), p.role())) return;
        throw ApiException.forbidden("Solo quien lo creó o quien modera puede cambiarlo");
    }

    private static boolean isAuthor(AuthPrincipal p, RoomItem it) { return p.userId().equals(it.getAuthorId()); }

    /** Referencias a otras cosas de la sala (el responsable de una tarea, el mensaje al que se responde…) deben existir. */
    private void checkRefs(Room room, String tool, Map<String, Object> clean) {
        if ("task".equals(tool) && clean.get("assignee") instanceof String a) {
            try {
                rooms.requireMember(UUID.fromString(a), room.getCode());
            } catch (ApiException e) {
                throw ApiException.badRequest("Esa persona no participa en la sala");
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Map<?, ?> m) { return (Map<String, Object>) m; }

    private static Map<String, Object> votesOf(Map<String, Object> d) {
        return d.get("votes") instanceof Map<?, ?> m ? castMap(m) : Map.of();
    }

    private static void dropOrphanVotes(Map<String, Object> clean) {
        Set<String> ids = new java.util.HashSet<>();
        for (Object o : (List<?>) clean.get("options")) ids.add(String.valueOf(((Map<?, ?>) o).get("id")));
        if (!(clean.get("votes") instanceof Map<?, ?> m)) return;
        Map<String, Object> votes = new LinkedHashMap<>();
        m.forEach((u, v) -> {
            List<?> kept = ((List<?>) v).stream().filter(x -> ids.contains(String.valueOf(x))).toList();
            if (!kept.isEmpty()) votes.put(String.valueOf(u), kept);
        });
        clean.put("votes", votes);
    }

    // ---- salida ----

    /** Lo que ve cada persona: en una votación anónima no se muestra quién votó qué, solo los totales (y a cada cual, su propio voto). */
    ItemDto view(RoomItem i, UUID viewer) {
        Map<String, Object> d = new LinkedHashMap<>(i.getData());
        if ("poll".equals(i.getTool())) {
            Map<String, Object> votes = votesOf(d);
            Map<String, Integer> counts = new LinkedHashMap<>();
            for (Object o : (List<?>) d.get("options")) counts.put(String.valueOf(((Map<?, ?>) o).get("id")), 0);
            votes.values().forEach(v -> ((List<?>) v).forEach(x -> counts.merge(String.valueOf(x), 1, Integer::sum)));
            d.put("counts", counts);
            d.put("total", votes.size());
            if (viewer != null) d.put("mine", votes.getOrDefault(viewer.toString(), List.of()));
            if (Boolean.TRUE.equals(d.get("anonymous"))) d.remove("votes");
        }
        return new ItemDto(i.getId(), i.getTool(), i.getAuthorId(), i.getAuthorName(), d, i.getSort(), i.getCreatedAt(), i.getUpdatedAt());
    }

    private ItemDto publish(RoomItem it, String op, UUID viewer) {
        events.publishEvent(new RoomEvent(it.getRoomId(), "item.changed", Map.of("tool", it.getTool(), "op", op, "item", view(it, null))));
        return view(it, viewer);
    }
}
