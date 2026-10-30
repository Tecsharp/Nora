package com.nora.notify;

import com.nora.room.Room;
import com.nora.room.RoomMemberRepository;
import com.nora.room.RoomMember;
import com.nora.ws.UserEvent;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Notificaciones de la aplicación. Cada una lleva un {@code link} con el lugar exacto ({@code tool}, {@code item}, {@code conv}, {@code file}…)
 * y se reparte en vivo a todas las sesiones de la persona como {@code notification.new}. Las del mismo tipo sin leer (p. ej. varios mensajes
 * de una misma conversación) se agrupan en una sola con contador para no inundar.
 */
@Service
public class NotificationService {

    public record Dto(UUID id, String roomCode, String roomName, String kind, String title, String body, Map<String, Object> link, int count, Instant createdAt, Instant readAt) {}

    private final NotificationRepository repo;
    private final RoomMemberRepository members;
    private final ApplicationEventPublisher events;

    public NotificationService(NotificationRepository repo, RoomMemberRepository members, ApplicationEventPublisher events) {
        this.repo = repo;
        this.members = members;
        this.events = events;
    }

    /** Avisa a una persona. {@code groupKey} (opcional) agrupa las que siguen sin leer. */
    @Transactional
    public void notify(UUID userId, Room room, String kind, String title, String body, Map<String, Object> link, String groupKey) {
        String t = clip(title, 200);
        String b = clip(body == null ? "" : body, 400);
        Map<String, Object> l = link == null ? Map.of() : link;
        Notification n = groupKey == null ? null : repo.findFirstByUserIdAndGroupKeyAndReadAtIsNull(userId, groupKey).orElse(null);
        if (n != null) {
            n.bump(t, b, l);
        } else {
            n = new Notification(userId, room == null ? null : room.getCode(), room == null ? null : clip(room.getName(), 80), kind, t, b, l, groupKey);
        }
        repo.save(n);
        events.publishEvent(new UserEvent(userId, "notification.new", dto(n)));
    }

    /** A todas las personas de la sala menos a quien provocó el aviso. */
    @Transactional
    public void notifyRoom(Room room, UUID except, String kind, String title, String body, Map<String, Object> link, String groupKeyPrefix) {
        for (RoomMember m : members.findByRoomId(room.getId())) {
            if (m.getUserId().equals(except)) continue;
            notify(m.getUserId(), room, kind, title, body, link, groupKeyPrefix == null ? null : groupKeyPrefix + ":" + room.getCode());
        }
    }

    @Transactional(readOnly = true)
    public Map<String, Object> list(UUID userId, int limit) {
        List<Dto> items = repo.findByUserIdOrderByCreatedAtDesc(userId, PageRequest.of(0, Math.max(1, Math.min(limit, 100)))).stream().map(NotificationService::dto).toList();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("items", items);
        out.put("unread", repo.countByUserIdAndReadAtIsNull(userId));
        return out;
    }

    @Transactional
    public void markRead(UUID userId, UUID id) {
        repo.findByIdAndUserId(id, userId).ifPresent((n) -> {
            if (n.getReadAt() == null) { n.markRead(); repo.save(n); }
        });
        events.publishEvent(new UserEvent(userId, "notification.read", Map.of("id", id)));
    }

    @Transactional
    public int markAllRead(UUID userId) {
        int n = repo.markAllRead(userId, Instant.now());
        events.publishEvent(new UserEvent(userId, "notification.read", Map.of("all", true)));
        return n;
    }

    /** Marca como vistas las de una conversación (al abrirla). */
    @Transactional
    public void markGroupRead(UUID userId, String groupKey) {
        if (repo.markGroupRead(userId, groupKey, Instant.now()) > 0) events.publishEvent(new UserEvent(userId, "notification.read", Map.of("group", groupKey)));
    }

    @Transactional
    public void purgeRoom(String code) { repo.deleteByRoom(code); }

    @Scheduled(cron = "0 17 4 * * *")
    @Transactional
    void cleanup() { repo.purgeRead(Instant.now().minus(Duration.ofDays(30))); }

    private static Dto dto(Notification n) {
        return new Dto(n.getId(), n.getRoomCode(), n.getRoomName(), n.getKind(), n.getTitle(), n.getBody(), n.getLink(), n.getCount(), n.getCreatedAt(), n.getReadAt());
    }

    private static String clip(String s, int max) { return s.length() > max ? s.substring(0, max - 1) + "…" : s; }
}
