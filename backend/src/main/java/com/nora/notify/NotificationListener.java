package com.nora.notify;

import com.nora.file.FileService;
import com.nora.room.Room;
import com.nora.room.RoomRepository;
import com.nora.user.UserRepository;
import com.nora.ws.RoomEvent;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/** Convierte algunos eventos de la sala en notificaciones persistentes (archivos nuevos, sala por expirar, inactiva o reactivada). */
@Component
public class NotificationListener {

    private final NotificationService notifications;
    private final RoomRepository rooms;
    private final UserRepository users;

    public NotificationListener(NotificationService notifications, RoomRepository rooms, UserRepository users) {
        this.notifications = notifications;
        this.rooms = rooms;
        this.users = users;
    }

    @EventListener
    void onRoomEvent(RoomEvent e) {
        switch (e.type()) {
            case "file.added" -> {
                if (!(e.data() instanceof FileService.FileDto f)) return;
                Room room = rooms.findById(e.roomId()).orElse(null);
                if (room == null) return;
                String who = users.findById(f.uploaderId()).map(u -> u.getDisplayName()).orElse("Alguien");
                Map<String, Object> link = new LinkedHashMap<>();
                link.put("tool", "files");
                link.put("file", f.id().toString());
                // varios archivos seguidos se juntan en un solo aviso
                notifications.notifyRoom(room, f.uploaderId(), "file", who + " subió archivos", f.name(), link, "file");
            }
            case "room.expiring" -> rooms.findById(e.roomId()).ifPresent(room -> {
                if (!(e.data() instanceof Map<?, ?> m)) return;
                notifications.notify(room.getOwnerId(), room, "room", "La sala expira en " + m.get("minutesLeft") + " min",
                        "Puedes ampliarla o dejarla «mantenida» desde sus ajustes.", Map.of("tool", "settings"), "expiring:" + room.getCode());
            });
            case "room.inactive" -> rooms.findById(e.roomId()).ifPresent(room ->
                    notifications.notifyRoom(room, null, "room", "La sala quedó inactiva", "Nada se borró. Quien la creó puede reactivarla.", Map.of(), "inactive"));
            case "room.reactivated" -> rooms.findById(e.roomId()).ifPresent(room ->
                    notifications.notifyRoom(room, null, "room", "La sala volvió a estar activa", "Ya puedes entrar de nuevo.", Map.of(), null));
            default -> { }
        }
    }
}
