package com.nora.room;

import com.nora.common.ApiException;
import com.nora.file.FileService;
import com.nora.upload.UploadService;
import com.nora.ws.PresenceService;
import com.nora.ws.RoomEvent;
import org.springframework.context.ApplicationEventPublisher;
import com.nora.room.RoomDtos.*;
import com.nora.user.Role;
import com.nora.user.User;
import com.nora.user.UserRepository;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RoomService {

    private static final Logger log = LoggerFactory.getLogger(RoomService.class);
    /** Sin caracteres ambiguos (0/O, 1/I). */
    private static final String ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    private static final int DEFAULT_MINUTES = 120;

    private final RoomRepository rooms;
    private final RoomMemberRepository members;
    private final UserRepository users;
    private final FileService files;
    private final UploadService uploads;
    private final PresenceService presence;
    private final ApplicationEventPublisher events;
    private final SecureRandom random = new SecureRandom();

    public RoomService(RoomRepository rooms, RoomMemberRepository members, UserRepository users, FileService files,
                       UploadService uploads, PresenceService presence, ApplicationEventPublisher events) {
        this.rooms = rooms;
        this.members = members;
        this.users = users;
        this.files = files;
        this.uploads = uploads;
        this.presence = presence;
        this.events = events;
    }

    @Transactional
    public RoomDto create(UUID userId, CreateRoomRequest req) {
        User user = user(userId);
        Instant now = Instant.now();
        if (user.getMaxActiveRooms() != null && rooms.countActiveByOwner(userId, now) >= user.getMaxActiveRooms()) {
            throw ApiException.forbidden("Has alcanzado el máximo de salas activas (" + user.getMaxActiveRooms() + ")");
        }
        Integer limit = user.getMaxRoomMinutes();
        Instant expires;
        if (req.minutes() != null && req.minutes() == 0) {
            if (limit != null) throw ApiException.forbidden("Tu cuenta no permite salas sin expiración");
            expires = null;
        } else {
            int minutes = req.minutes() != null ? req.minutes() : (limit != null ? Math.min(limit, DEFAULT_MINUTES) : DEFAULT_MINUTES);
            if (limit != null && minutes > limit) {
                throw ApiException.forbidden("Tu cuenta permite salas de hasta " + limit + " minutos");
            }
            expires = now.plus(Duration.ofMinutes(minutes));
        }
        Room room = saveWithUniqueCode(req.name().trim(), userId, expires);
        members.save(new RoomMember(room.getId(), userId));
        return toDto(room, userId);
    }

    private Room saveWithUniqueCode(String name, UUID ownerId, Instant expires) {
        for (int i = 0; i < 10; i++) {
            try {
                return rooms.saveAndFlush(new Room(generateCode(), name, ownerId, expires));
            } catch (DataIntegrityViolationException e) {
                // colisión de código: reintentar
            }
        }
        throw new IllegalStateException("No se pudo generar un código de sala único");
    }

    private String generateCode() {
        StringBuilder sb = new StringBuilder("NX-");
        for (int i = 0; i < 6; i++) sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        return sb.toString();
    }

    @Transactional
    public RoomDto join(UUID userId, String code) {
        Room room = openRoom(code);
        if (!members.existsById(new RoomMember.Key(room.getId(), userId))) {
            User owner = user(room.getOwnerId());
            if (owner.getMaxParticipants() != null && members.countByRoomId(room.getId()) >= owner.getMaxParticipants()) {
                throw ApiException.forbidden("La sala está llena");
            }
            members.save(new RoomMember(room.getId(), userId));
            events.publishEvent(new RoomEvent(room.getId(), "member.joined",
                    Map.of("userId", userId, "displayName", user(userId).getDisplayName())));
        }
        return get(userId, code);
    }

    /** Devuelve la sala; la presencia ("conectado") la aporta el WebSocket. */
    @Transactional(readOnly = true)
    public RoomDto get(UUID userId, String code) {
        return toDto(requireMember(userId, code), userId);
    }

    @Transactional(readOnly = true)
    public List<RoomSummary> mine(UUID userId) {
        return rooms.findActiveForMember(userId, Instant.now()).stream()
                .map(r -> new RoomSummary(r.getCode(), r.getName(), r.getExpiresAt(), r.getOwnerId().equals(userId)))
                .toList();
    }

    @Transactional
    public void close(UUID userId, Role role, String code) {
        Room room = rooms.findByCode(normalize(code)).orElseThrow(() -> ApiException.notFound("Sala no encontrada"));
        if (!room.getOwnerId().equals(userId) && role != Role.ADMIN) {
            throw ApiException.forbidden("Solo el propietario puede cerrar la sala");
        }
        destroy(room, "closed");
    }

    /**
     * Cambia la expiración. La duración total (desde la creación) no puede superar el límite del propietario, salvo que
     * quien lo pide sea administrador; y siempre debe quedar al menos un minuto.
     */
    @Transactional
    public RoomDto adjustExpiry(UUID userId, Role role, String code, ExpiryRequest req) {
        Room room = openRoom(code);
        if (!room.getOwnerId().equals(userId) && role != Role.ADMIN) {
            throw ApiException.forbidden("Solo el propietario puede cambiar la duración de la sala");
        }
        Integer limit = role == Role.ADMIN ? null : user(room.getOwnerId()).getMaxRoomMinutes();
        Instant now = Instant.now();
        if (Boolean.TRUE.equals(req.unlimited())) {
            if (limit != null) throw ApiException.forbidden("Tu cuenta no permite salas sin expiración");
            room.setExpiresAt(null);
        } else {
            if (req.deltaMinutes() == null || req.deltaMinutes() == 0) throw ApiException.badRequest("Indica cuántos minutos añadir o quitar");
            Instant base = room.getExpiresAt() != null ? room.getExpiresAt() : now;
            Instant next = base.plus(Duration.ofMinutes(req.deltaMinutes()));
            if (next.isBefore(now.plus(Duration.ofMinutes(1)))) {
                throw ApiException.badRequest("La sala debe durar al menos 1 minuto más");
            }
            if (limit != null && Duration.between(room.getCreatedAt(), next).toMinutes() > limit) {
                throw ApiException.forbidden("Tu cuenta permite salas de hasta " + limit + " minutos en total");
            }
            room.setExpiresAt(next);
        }
        rooms.save(room);
        Map<String, Object> data = new java.util.HashMap<>();
        data.put("expiresAt", room.getExpiresAt());
        events.publishEvent(new RoomEvent(room.getId(), "room.updated", data));
        return toDto(room, userId);
    }

    /** Sala abierta (no expirada) en la que el usuario participa. */
    @Transactional(readOnly = true)
    public Room requireMember(UUID userId, String code) {
        Room room = openRoom(code);
        if (!members.existsById(new RoomMember.Key(room.getId(), userId))) {
            throw ApiException.forbidden("No participas en esta sala");
        }
        return room;
    }

    private Room openRoom(String code) {
        Room room = rooms.findByCode(normalize(code)).orElseThrow(() -> ApiException.notFound("Sala no encontrada"));
        if (room.isExpired()) throw new ApiException(org.springframework.http.HttpStatus.GONE, "La sala ha expirado");
        return room;
    }

    private static String normalize(String code) {
        return code == null ? "" : code.trim().toUpperCase(Locale.ROOT);
    }

    private RoomDto toDto(Room room, UUID viewer) {
        List<RoomMember> ms = members.findByRoomId(room.getId());
        Map<UUID, User> byId = users.findAllById(ms.stream().map(RoomMember::getUserId).toList()).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        List<ParticipantDto> parts = ms.stream()
                .filter(m -> byId.containsKey(m.getUserId()))
                .sorted((a, b) -> a.getJoinedAt().compareTo(b.getJoinedAt()))
                .map(m -> new ParticipantDto(m.getUserId(), byId.get(m.getUserId()).getDisplayName(),
                        presence.isOnline(room.getId(), m.getUserId()), m.getUserId().equals(room.getOwnerId())))
                .toList();
        return new RoomDto(room.getId(), room.getCode(), room.getName(), room.getCreatedAt(), room.getExpiresAt(),
                room.getOwnerId(), room.getOwnerId().equals(viewer), parts);
    }

    private User user(UUID id) {
        return users.findById(id).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
    }

    private void destroy(Room room, String reason) {
        files.deleteAllForRoom(room.getId());
        uploads.abortAllForRoom(room.getId());
        rooms.delete(room);
        events.publishEvent(new RoomEvent(room.getId(), "room.closed", Map.of("reason", reason, "name", room.getName())));
    }

    /** Las salas expiradas se destruyen junto con todos sus archivos. */
    @Scheduled(fixedDelay = 60_000, initialDelay = 30_000)
    @Transactional
    public void purgeExpired() {
        for (Room room : rooms.findExpired(Instant.now())) {
            try {
                destroy(room, "expired");
                log.info("Sala expirada eliminada: {}", room.getCode());
            } catch (Exception e) {
                log.error("No se pudo eliminar la sala expirada {}", room.getCode(), e);
            }
        }
    }
}
