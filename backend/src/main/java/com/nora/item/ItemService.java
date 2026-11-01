package com.nora.item;

import com.nora.auth.AuthPrincipal;
import com.nora.call.CallService;
import com.nora.common.ApiException;
import com.nora.file.RoomFileRepository;
import com.nora.notify.NotificationService;
import com.nora.room.Room;
import com.nora.room.RoomService;
import com.nora.user.UserRepository;
import com.nora.ws.RoomEvent;
import com.nora.ws.UserEvent;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Scheduled;
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
    private final CallService calls;

    public ItemService(RoomItemRepository items, RoomService rooms, UserRepository users, ApplicationEventPublisher events, NotificationService notifications, RoomFileRepository files, @Lazy CallService calls) {
        this.calls = calls;
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
        return found.stream().filter(i -> canSee(i, p.userId())).map(i -> view(i, p.userId())).toList();
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
        if ("event".equals(tool)) syncCall(room, it, clean, wantCall(data), openCall(data));
        items.save(it);
        notifyCreated(room, it, p.userId());
        return publish(it, "created", p.userId());
    }

    @Transactional
    public ItemDto update(AuthPrincipal p, String code, String tool, UUID id, Map<String, Object> data, Double sort) {
        tool(tool);
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        RoomItem it = items.lockById(id, room.getId(), tool).orElseThrow(() -> ApiException.notFound("Ese elemento ya no existe"));
        if (!canSee(it, p.userId())) throw ApiException.notFound("Ese elemento ya no existe");
        requireCanEdit(room, p, it);
        Object prevAssignee = it.getData().get("assignee");
        boolean prevPrivate = isPrivate(it);
        Set<UUID> prevInvited = invitedOf(it.getData());
        Set<UUID> prevSee = seers(it);
        if (data != null) {
            Map<String, Object> clean = ItemSchemas.clean(tool, data, false);
            checkRefs(room, tool, clean);
            // lo que gestiona el servidor (votos, respuestas, reacciones) se conserva
            for (String f : ItemSchemas.SERVER_FIELDS.getOrDefault(tool, Set.of())) if (it.getData().containsKey(f)) clean.put(f, it.getData().get(f));
            if ("poll".equals(tool)) dropOrphanVotes(clean);
            if ("event".equals(tool)) syncCall(room, it, clean, data.containsKey("withCall") ? wantCall(data) : null, openCall(data));
            it.setData(clean);
        }
        if (sort != null && Double.isFinite(sort)) it.setSort(sort);
        items.save(it);
        if ("task".equals(tool) && it.getData().get("assignee") instanceof String a && !a.equals(prevAssignee)) notifyAssigned(room, it, a, p.userId());
        if ("event".equals(tool)) {
            Set<UUID> fresh = new java.util.LinkedHashSet<>(invitedOf(it.getData()));
            fresh.removeAll(prevInvited);
            notifyInvited(room, it, fresh, p.userId());
            // un evento que pasa a ser personal desaparece para el resto; quien deja de estar invitado a uno personal también lo pierde
            if (!prevPrivate && isPrivate(it)) events.publishEvent(new RoomEvent(it.getRoomId(), "item.changed", Map.of("tool", "event", "op", "deleted", "item", Map.of("id", it.getId()))));
            else if (prevPrivate && isPrivate(it)) for (UUID u : prevSee) if (!seers(it).contains(u)) events.publishEvent(new UserEvent(u, "item.changed", Map.of("tool", "event", "op", "deleted", "item", Map.of("id", it.getId()))));
        }
        return publish(it, "updated", p.userId());
    }

    @Transactional
    public void delete(AuthPrincipal p, String code, String tool, UUID id) {
        tool(tool);
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        RoomItem it = items.findByIdAndRoomIdAndTool(id, room.getId(), tool).orElseThrow(() -> ApiException.notFound("Ese elemento ya no existe"));
        if (!isAuthor(p, it) && !rooms.canModerate(room, p.userId(), p.role())) throw ApiException.forbidden("Solo quien lo creó o quien modera puede borrarlo");
        if ("event".equals(tool) && it.getData().get("call") instanceof String c) calls.cancelScheduled(c);
        items.delete(it);
        events.publishEvent(new RoomEvent(room.getId(), "item.changed", Map.of("tool", tool, "op", "deleted", "item", Map.of("id", id))));
        if ("event".equals(tool)) events.publishEvent(new RoomEvent(room.getId(), "availability.changed", Map.of()));
    }

    /** Acciones que cambian solo una parte (votar, reaccionar…) y se hacen con cerrojo para no pisarse. */
    @Transactional
    public ItemDto act(AuthPrincipal p, String code, String tool, UUID id, String action, Map<String, Object> body) {
        tool(tool);
        Room room = rooms.requireMember(p.userId(), code);
        RoomItem it = items.lockById(id, room.getId(), tool).orElseThrow(() -> ApiException.notFound("Ese elemento ya no existe"));
        if (!canSee(it, p.userId())) throw ApiException.notFound("Ese elemento ya no existe");
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
            case "event" -> {
                Set<UUID> invited = invitedOf(d);
                if (!invited.isEmpty() || isPrivate(it)) notifyInvited(room, it, invited, actor); // con invitados o personal: solo se avisa a quien invitaron
                else notifications.notifyRoom(room, actor, "event", who + " agendó un evento", eventLine(d), link("calendar", it.getId()), null);
            }
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

    private void notifyInvited(Room room, RoomItem it, Set<UUID> invited, UUID actor) {
        for (UUID u : invited) {
            if (u.equals(actor) || u.equals(it.getAuthorId())) continue;
            notifications.notify(u, room, "event", it.getAuthorName() + " te invitó a una reunión", eventLine(it.getData()) + (it.getData().get("call") != null ? " · con llamada" : ""), link("calendar", it.getId()), null);
        }
    }

    // ---- invitados, eventos personales y llamada del evento ----

    private static Set<UUID> invitedOf(Map<String, Object> d) {
        Set<UUID> out = new java.util.LinkedHashSet<>();
        if (d.get("invitees") instanceof List<?> l) for (Object o : l) { try { out.add(UUID.fromString(String.valueOf(o))); } catch (IllegalArgumentException ignored) { /* no válido */ } }
        return out;
    }

    private static boolean isPrivate(RoomItem it) { return "event".equals(it.getTool()) && Boolean.TRUE.equals(it.getData().get("private")); }

    /** Quién puede ver el evento: todos, salvo los personales (solo quien los creó y sus invitados). */
    private static Set<UUID> seers(RoomItem it) {
        Set<UUID> s = new java.util.LinkedHashSet<>(invitedOf(it.getData()));
        if (it.getAuthorId() != null) s.add(it.getAuthorId());
        return s;
    }

    private static boolean canSee(RoomItem it, UUID viewer) { return !isPrivate(it) || (viewer != null && seers(it).contains(viewer)); }

    /** Quién tiene ese hueco ocupado: quien lo creó y sus invitados (o, si no hay invitados, quien dijo «Voy»), menos quien dijo «No voy». */
    private static Set<UUID> attendees(RoomItem it) {
        Map<String, Object> d = it.getData();
        Set<UUID> out = new java.util.LinkedHashSet<>();
        if (it.getAuthorId() != null) out.add(it.getAuthorId());
        out.addAll(invitedOf(d));
        if (d.get("rsvp") instanceof Map<?, ?> m) {
            for (Map.Entry<?, ?> e : m.entrySet()) {
                try {
                    UUID u = UUID.fromString(String.valueOf(e.getKey()));
                    if ("yes".equals(e.getValue())) out.add(u);
                    else if ("no".equals(e.getValue())) out.remove(u);
                } catch (IllegalArgumentException ignored) { /* no válido */ }
            }
        }
        return out;
    }

    private static Boolean wantCall(Map<String, Object> data) { return data != null && Boolean.TRUE.equals(data.get("withCall")); }

    private static boolean openCall(Map<String, Object> data) { return data == null || !"HOST".equals(data.get("callAccess")); }

    /** Crea, reprograma o quita la llamada del evento según lo que se pidió; el código queda en el propio evento. */
    private void syncCall(Room room, RoomItem it, Map<String, Object> clean, Boolean want, boolean open) {
        String existing = clean.get("call") instanceof String c ? c : null;
        Long start = clean.get("startMs") instanceof Number n ? n.longValue() : null;
        Long end = clean.get("endMs") instanceof Number n ? n.longValue() : null;
        String title = String.valueOf(clean.get("title"));
        if (want == null) want = existing != null;
        if (want && existing == null) {
            clean.put("call", calls.createScheduled(room, it.getAuthorId(), it.getAuthorName(), title, open, start, end, it.getId()));
        } else if (want) {
            calls.reschedule(existing, title, start, end);
        } else if (existing != null) {
            calls.cancelScheduled(existing);
            clean.remove("call");
        }
    }

    /** Disponibilidad de las personas de la sala entre dos fechas: solo huecos ocupados; el título solo lo ve quien puede ver ese evento. */
    @Transactional(readOnly = true)
    public Map<String, Object> availability(AuthPrincipal p, String code, String from, String to) {
        String f = from == null || from.length() < 10 ? null : from.substring(0, 10);
        String t = to == null || to.length() < 10 ? f : to.substring(0, 10);
        if (f == null || t == null || t.compareTo(f) < 0) throw ApiException.badRequest("Fechas no válidas");
        var dto = rooms.get(p.userId(), code);
        Room room = rooms.requireMember(p.userId(), code);
        String lo = f + "T00:00", hi = t + "T23:59";
        Map<UUID, List<Map<String, Object>>> busy = new LinkedHashMap<>();
        for (var part : dto.participants()) busy.put(part.userId(), new ArrayList<>());
        for (RoomItem it : items.findOrdered(room.getId(), "event", PageRequest.of(0, 5000))) {
            Map<String, Object> d = it.getData();
            String start = String.valueOf(d.get("start")), end = String.valueOf(d.get("end"));
            boolean allDay = Boolean.TRUE.equals(d.get("allDay"));
            if (allDay) end = end.substring(0, 10) + "T23:59";
            if (start.compareTo(hi) > 0 || end.compareTo(lo) < 0) continue;
            boolean visible = canSee(it, p.userId());
            Map<String, Object> slot = new LinkedHashMap<>();
            slot.put("start", start);
            slot.put("end", end);
            slot.put("allDay", allDay);
            slot.put("eventId", visible ? it.getId() : null);
            slot.put("title", visible ? d.get("title") : null);
            for (UUID u : attendees(it)) if (busy.containsKey(u)) busy.get(u).add(slot);
        }
        List<Map<String, Object>> users = new ArrayList<>();
        for (var part : dto.participants()) {
            List<Map<String, Object>> l = busy.get(part.userId());
            l.sort((a, b) -> String.valueOf(a.get("start")).compareTo(String.valueOf(b.get("start"))));
            users.add(Map.of("userId", part.userId(), "displayName", part.displayName(), "avatarVersion", part.avatarVersion(), "busy", l));
        }
        return Map.of("from", f, "to", t, "users", users);
    }

    /** Recordatorio 10 minutos antes de cada reunión, a quien la tiene ocupada, con enlace directo a la llamada si la tiene. */
    @Scheduled(fixedDelay = 60_000, initialDelay = 45_000)
    @Transactional
    public void remindEvents() {
        long now = System.currentTimeMillis();
        for (RoomItem it : items.dueEvents(now, now + 10 * 60_000L)) {
            Room room = rooms.roomById(it.getRoomId());
            Map<String, Object> d = new LinkedHashMap<>(it.getData());
            d.put("reminded", true);
            it.setData(d);
            items.save(it);
            if (room == null || Boolean.TRUE.equals(d.get("allDay"))) continue;
            long mins = Math.max(1, Math.round((((Number) d.get("startMs")).longValue() - now) / 60_000.0));
            Map<String, Object> l = d.get("call") instanceof String c ? new LinkedHashMap<>(Map.of("call", c)) : link("calendar", it.getId());
            for (UUID u : attendees(it)) {
                if (!canSee(it, u)) continue;
                notifications.notify(u, room, "event", "«" + d.get("title") + "» empieza en " + mins + " min", d.get("call") != null ? "Toca para unirte a la llamada" : eventLine(d), l, null);
            }
        }
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
        if (isPrivate(it) && !isAuthor(p, it)) throw ApiException.forbidden("Solo quien lo creó puede cambiar un evento personal");
        if (EDIT_ANY.contains(it.getTool()) || isAuthor(p, it) || rooms.canModerate(room, p.userId(), p.role())) return;
        throw ApiException.forbidden("Solo quien lo creó o quien modera puede cambiarlo");
    }

    private static boolean isAuthor(AuthPrincipal p, RoomItem it) { return p.userId().equals(it.getAuthorId()); }

    /** Referencias a otras cosas de la sala (el responsable de una tarea, el mensaje al que se responde…) deben existir. */
    private void checkRefs(Room room, String tool, Map<String, Object> clean) {
        if ("event".equals(tool)) {
            for (UUID u : invitedOf(clean)) {
                try {
                    rooms.requireMember(u, room.getCode());
                } catch (ApiException e) {
                    throw ApiException.badRequest("Una de las personas invitadas no participa en la sala");
                }
            }
        }
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
        Map<String, Object> payload = Map.of("tool", it.getTool(), "op", op, "item", view(it, null));
        if (isPrivate(it)) {
            // un evento personal solo llega a quien lo ve; el resto solo sabe que cambió la disponibilidad
            for (UUID u : seers(it)) events.publishEvent(new UserEvent(u, "item.changed", payload));
        } else {
            events.publishEvent(new RoomEvent(it.getRoomId(), "item.changed", payload));
        }
        if ("event".equals(it.getTool())) events.publishEvent(new RoomEvent(it.getRoomId(), "availability.changed", Map.of()));
        return view(it, viewer);
    }
}
