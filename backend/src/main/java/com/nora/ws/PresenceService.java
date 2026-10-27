package com.nora.ws;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

/** Quién está conectado en cada sala. Un usuario con varias pestañas cuenta una sola vez. */
@Service
public class PresenceService {

    private final Map<UUID, Map<UUID, Set<String>>> rooms = new ConcurrentHashMap<>();

    /** @return true si el usuario acaba de pasar a estar conectado en esa sala. */
    public synchronized boolean join(UUID roomId, UUID userId, String sessionId) {
        Set<String> sessions = rooms.computeIfAbsent(roomId, k -> new ConcurrentHashMap<>())
                .computeIfAbsent(userId, k -> ConcurrentHashMap.newKeySet());
        boolean first = sessions.isEmpty();
        sessions.add(sessionId);
        return first;
    }

    /** @return true si era la última sesión del usuario en esa sala. */
    public synchronized boolean leave(UUID roomId, UUID userId, String sessionId) {
        Map<UUID, Set<String>> users = rooms.get(roomId);
        if (users == null) return false;
        Set<String> sessions = users.get(userId);
        if (sessions == null || !sessions.remove(sessionId)) return false;
        if (!sessions.isEmpty()) return false;
        users.remove(userId);
        if (users.isEmpty()) rooms.remove(roomId);
        return true;
    }

    public Set<UUID> onlineUsers(UUID roomId) {
        Map<UUID, Set<String>> users = rooms.get(roomId);
        return users == null ? Set.of() : new HashSet<>(users.keySet());
    }

    public boolean isOnline(UUID roomId, UUID userId) {
        Map<UUID, Set<String>> users = rooms.get(roomId);
        return users != null && users.containsKey(userId);
    }

    public Set<UUID> activeRooms() {
        return new HashSet<>(rooms.keySet());
    }

    public void clearRoom(UUID roomId) {
        rooms.remove(roomId);
    }
}
