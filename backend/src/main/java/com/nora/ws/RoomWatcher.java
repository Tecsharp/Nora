package com.nora.ws;

import com.nora.room.Room;
import com.nora.room.RoomRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Avisa a quienes están dentro de una sala cuando le quedan 5 y 1 minutos. */
@Component
public class RoomWatcher {

    private final PresenceService presence;
    private final RoomRepository rooms;
    private final ApplicationEventPublisher events;
    private final Map<UUID, Integer> lastWarning = new ConcurrentHashMap<>();

    public RoomWatcher(PresenceService presence, RoomRepository rooms, ApplicationEventPublisher events) {
        this.presence = presence;
        this.rooms = rooms;
        this.events = events;
    }

    @Scheduled(fixedDelay = 15_000, initialDelay = 15_000)
    void check() {
        Set<UUID> active = presence.activeRooms();
        lastWarning.keySet().retainAll(active);
        for (UUID roomId : active) {
            Room room = rooms.findById(roomId).orElse(null);
            if (room == null || room.getExpiresAt() == null) continue;
            long seconds = Duration.between(Instant.now(), room.getExpiresAt()).toSeconds();
            int threshold = seconds <= 60 ? 1 : seconds <= 300 ? 5 : 0;
            if (threshold == 0) {
                lastWarning.remove(roomId); // la sala se amplió: volverá a avisar cuando se acerque el final
                continue;
            }
            Integer last = lastWarning.get(roomId);
            if (last != null && last <= threshold) continue;
            lastWarning.put(roomId, threshold);
            events.publishEvent(new RoomEvent(roomId, "room.expiring",
                    Map.of("minutesLeft", threshold, "expiresAt", room.getExpiresAt())));
        }
    }
}
