package com.nora.room;

import com.nora.common.ApiException;
import com.nora.notify.NotificationService;
import com.nora.file.FileService;
import com.nora.upload.UploadService;
import com.nora.ws.PresenceService;
import com.nora.ws.RoomEvent;
import com.nora.ws.UserEvent;
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
    private final RoomJoinRequestRepository joinRequests;
    private final UserRepository users;
    private final FileService files;
    private final UploadService uploads;
    private final PresenceService presence;
    private final ApplicationEventPublisher events;
    private final NotificationService notifications;
    private final SecureRandom random = new SecureRandom();

    public RoomService(RoomRepository rooms, RoomMemberRepository members, RoomJoinRequestRepository joinRequests, UserRepository users, FileService files,
                       UploadService uploads, PresenceService presence, ApplicationEventPublisher events, NotificationService notifications) {
        this.notifications = notifications;
        this.rooms = rooms;
        this.members = members;
        this.joinRequests = joinRequests;
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
        applyOptions(room, user, req.requireApproval(), req.defaultRole(), req.maxParticipants(), false);
        room.setKeepWhenExpired(Boolean.TRUE.equals(req.keepWhenExpired()));
        rooms.save(room);
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

    /** Valida y aplica las opciones de la sala. `zeroMeansNone`: en los cambios, 0 quita el límite propio. */
    private void applyOptions(Room room, User owner, Boolean approval, RoomRole role, Integer max, boolean zeroMeansNone) {
        if (approval != null) room.setRequireApproval(approval);
        if (role != null) {
            if (role == RoomRole.MODERATOR) throw ApiException.badRequest("El rol por defecto solo puede ser colaborador o lector");
            room.setDefaultRole(role);
        }
        if (max != null) {
            if (zeroMeansNone && max == 0) {
                room.setMaxParticipants(null);
            } else {
                if (max < 2) throw ApiException.badRequest("Mínimo 2 participantes");
                if (owner.getMaxParticipants() != null && max > owner.getMaxParticipants()) {
                    throw ApiException.forbidden("Tu cuenta permite hasta " + owner.getMaxParticipants() + " participantes por sala");
                }
                room.setMaxParticipants(max);
            }
        }
    }

    private boolean isFull(Room room) {
        Integer limit = room.getMaxParticipants();
        Integer cap = user(room.getOwnerId()).getMaxParticipants();
        if (cap != null && (limit == null || cap < limit)) limit = cap;
        return limit != null && members.countByRoomId(room.getId()) >= limit;
    }

    private void addMember(Room room, UUID userId) {
        if (isFull(room)) throw ApiException.forbidden("La sala está llena");
        RoomMember m = new RoomMember(room.getId(), userId);
        m.setRole(room.getDefaultRole());
        members.save(m);
        events.publishEvent(new RoomEvent(room.getId(), "member.joined",
                Map.of("userId", userId, "displayName", user(userId).getDisplayName())));
        if (!userId.equals(room.getOwnerId())) {
            notifications.notify(room.getOwnerId(), room, "member", user(userId).getDisplayName() + " entró a la sala", "", Map.of("tool", "members"), null);
        }
    }

    /** Entra con el código. Si la sala pide aprobación, deja una solicitud y avisa al propietario. */
    @Transactional
    public JoinResult join(UUID userId, String code) {
        Room room = openRoom(code);
        if (members.existsById(new RoomMember.Key(room.getId(), userId))) return new JoinResult(get(userId, code), false, room.getName());
        if (!room.isRequireApproval()) {
            addMember(room, userId);
            return new JoinResult(get(userId, code), false, room.getName());
        }
        if (isFull(room)) throw ApiException.forbidden("La sala está llena");
        if (joinRequests.findByRoomIdAndUserId(room.getId(), userId).isEmpty()) {
            joinRequests.save(new RoomJoinRequest(room.getId(), userId));
            notifications.notify(room.getOwnerId(), room, "join", user(userId).getDisplayName() + " quiere entrar", "Solicitud pendiente en «" + room.getName() + "»", Map.of("tool", "members"), "join:" + room.getCode());
            events.publishEvent(new UserEvent(room.getOwnerId(), "join.requested",
                    Map.of("code", room.getCode(), "roomName", room.getName(), "userId", userId, "displayName", user(userId).getDisplayName())));
        }
        return new JoinResult(null, true, room.getName());
    }

    /** ¿Sigue pendiente mi solicitud? (respaldo por si se pierde el aviso en vivo). */
    @Transactional(readOnly = true)
    public String joinStatus(UUID userId, String code) {
        Room room = openRoom(code);
        if (members.existsById(new RoomMember.Key(room.getId(), userId))) return "MEMBER";
        return joinRequests.findByRoomIdAndUserId(room.getId(), userId).isPresent() ? "PENDING" : "NONE";
    }

    @Transactional
    public void cancelJoin(UUID userId, String code) {
        Room room = openRoom(code);
        joinRequests.findByRoomIdAndUserId(room.getId(), userId).ifPresent(joinRequests::delete);
        events.publishEvent(new UserEvent(room.getOwnerId(), "join.cancelled", Map.of("code", room.getCode(), "userId", userId)));
    }

    private Room ownedRoom(UUID actorId, Role sysRole, String code, String denied) {
        Room room = requireMember(actorId, code);
        if (!room.getOwnerId().equals(actorId) && sysRole != Role.ADMIN) throw ApiException.forbidden(denied);
        return room;
    }

    @Transactional(readOnly = true)
    public List<JoinRequestDto> joinRequests(UUID actorId, Role sysRole, String code) {
        Room room = ownedRoom(actorId, sysRole, code, "Solo el propietario ve las solicitudes");
        List<RoomJoinRequest> list = joinRequests.findByRoomIdOrderByCreatedAtAsc(room.getId());
        Map<UUID, User> byId = users.findAllById(list.stream().map(RoomJoinRequest::getUserId).toList()).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        return list.stream().filter(r -> byId.containsKey(r.getUserId()))
                .map(r -> new JoinRequestDto(r.getUserId(), byId.get(r.getUserId()).getDisplayName(), r.getCreatedAt())).toList();
    }

    /** El propietario acepta o rechaza una solicitud; la persona recibe el resultado en vivo. */
    @Transactional
    public void decideJoin(UUID actorId, Role sysRole, String code, UUID targetId, boolean approve) {
        Room room = ownedRoom(actorId, sysRole, code, "Solo el propietario responde a las solicitudes");
        RoomJoinRequest req = joinRequests.findByRoomIdAndUserId(room.getId(), targetId)
                .orElseThrow(() -> ApiException.notFound("La solicitud ya no existe"));
        if (approve) {
            addMember(room, targetId);
            events.publishEvent(new UserEvent(targetId, "join.approved", Map.of("code", room.getCode(), "roomName", room.getName())));
        } else {
            events.publishEvent(new UserEvent(targetId, "join.denied", Map.of("code", room.getCode(), "roomName", room.getName())));
        }
        joinRequests.delete(req);
    }

    @Transactional
    public RoomDto updateSettings(UUID actorId, Role sysRole, String code, SettingsRequest req) {
        Room room = ownedRoom(actorId, sysRole, code, "Solo el propietario cambia las opciones de la sala");
        applyOptions(room, user(room.getOwnerId()), req.requireApproval(), req.defaultRole(), req.maxParticipants(), true);
        if (req.keepWhenExpired() != null) room.setKeepWhenExpired(req.keepWhenExpired());
        rooms.save(room);
        publishUpdate(room);
        return toDto(room, actorId);
    }

    private void publishUpdate(Room room) {
        Map<String, Object> data = new java.util.HashMap<>();
        data.put("expiresAt", room.getExpiresAt());
        data.put("settings", settings(room));
        events.publishEvent(new RoomEvent(room.getId(), "room.updated", data));
    }

    private static RoomSettings settings(Room room) {
        return new RoomSettings(room.isRequireApproval(), room.getDefaultRole().name(), room.getMaxParticipants(), room.isKeepWhenExpired());
    }

    /** Devuelve la sala; la presencia ("conectado") la aporta el WebSocket. */
    @Transactional(readOnly = true)
    public RoomDto get(UUID userId, String code) {
        return toDto(requireMember(userId, code), userId);
    }

    @Transactional(readOnly = true)
    public List<RoomSummary> mine(UUID userId) {
        return rooms.findVisibleForMember(userId, Instant.now()).stream()
                .map(r -> new RoomSummary(r.getCode(), r.getName(), r.getExpiresAt(), r.getOwnerId().equals(userId), r.isKeepWhenExpired(), r.isExpired()))
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
        publishUpdate(room);
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

    /** Igual que requireMember, pero rechaza a quien solo tiene el rol de lector. */
    @Transactional(readOnly = true)
    public Room requireWriter(UUID userId, Role sysRole, String code) {
        Room room = requireMember(userId, code);
        if (sysRole != Role.ADMIN && !room.getOwnerId().equals(userId) && memberRole(room, userId) == RoomRole.VIEWER) {
            throw ApiException.forbidden("Tu rol en esta sala es de solo lectura");
        }
        return room;
    }

    /** ¿Puede editar? (todos menos los lectores). */
    @Transactional(readOnly = true)
    public boolean canWrite(Room room, UUID userId, Role sysRole) {
        return sysRole == Role.ADMIN || room.getOwnerId().equals(userId) || memberRole(room, userId) != RoomRole.VIEWER;
    }

    /** Propietario, administrador del sistema o moderador de la sala: pueden gestionar el contenido de otros. */
    @Transactional(readOnly = true)
    public boolean canModerate(Room room, UUID userId, Role sysRole) {
        return sysRole == Role.ADMIN || room.getOwnerId().equals(userId) || memberRole(room, userId) == RoomRole.MODERATOR;
    }

    private RoomRole memberRole(Room room, UUID userId) {
        return members.findById(new RoomMember.Key(room.getId(), userId)).map(RoomMember::getRole).orElse(RoomRole.MEMBER);
    }

    /** El propietario (o un administrador) asigna el rol de otro participante. */
    @Transactional
    public ParticipantDto setMemberRole(UUID actorId, Role sysRole, String code, UUID targetId, RoomRole role) {
        Room room = requireMember(actorId, code);
        if (!room.getOwnerId().equals(actorId) && sysRole != Role.ADMIN) {
            throw ApiException.forbidden("Solo el propietario puede asignar roles");
        }
        if (room.getOwnerId().equals(targetId)) throw ApiException.badRequest("El propietario no puede cambiar de rol");
        RoomMember m = members.findById(new RoomMember.Key(room.getId(), targetId))
                .orElseThrow(() -> ApiException.notFound("Esa persona no participa en la sala"));
        m.setRole(role);
        members.save(m);
        String name = user(targetId).getDisplayName();
        events.publishEvent(new RoomEvent(room.getId(), "member.updated", Map.of("userId", targetId, "displayName", name, "role", role.name())));
        return new ParticipantDto(targetId, name, presence.isOnline(room.getId(), targetId), false, role.name(), user(targetId).getAvatarVersion());
    }

    /** El propietario (o un administrador) expulsa a un participante: deja de ser miembro y se le corta el acceso en vivo. */
    @Transactional
    public void removeMember(UUID actorId, Role sysRole, String code, UUID targetId) {
        Room room = requireMember(actorId, code);
        if (!room.getOwnerId().equals(actorId) && sysRole != Role.ADMIN) throw ApiException.forbidden("Solo el propietario puede expulsar a otras personas");
        if (room.getOwnerId().equals(targetId)) throw ApiException.badRequest("No se puede expulsar al propietario de la sala");
        if (actorId.equals(targetId)) throw ApiException.badRequest("No puedes expulsarte a ti mismo");
        RoomMember m = members.findById(new RoomMember.Key(room.getId(), targetId))
                .orElseThrow(() -> ApiException.notFound("Esa persona ya no participa en la sala"));
        members.delete(m);
        joinRequests.findByRoomIdAndUserId(room.getId(), targetId).ifPresent(joinRequests::delete);
        String name = user(targetId).getDisplayName();
        events.publishEvent(new UserEvent(targetId, "member.kicked", Map.of("code", room.getCode(), "roomName", room.getName())));
        events.publishEvent(new RoomEvent(room.getId(), "member.removed", Map.of("userId", targetId, "displayName", name)));
    }

    /** Borrado de cuenta: se destruyen las salas de la persona (con sus archivos) y se la saca de las demás. */
    @Transactional
    public void removeAccountFromRooms(UUID userId) {
        for (Room r : rooms.findByOwnerId(userId)) destroy(r, "closed");
        for (RoomMember m : members.findByUserId(userId)) {
            String name = user(userId).getDisplayName();
            events.publishEvent(new RoomEvent(m.getRoomId(), "member.removed", Map.of("userId", userId, "displayName", name)));
        }
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
                        presence.isOnline(room.getId(), m.getUserId()), m.getUserId().equals(room.getOwnerId()),
                        m.getUserId().equals(room.getOwnerId()) ? "OWNER" : m.getRole().name(), byId.get(m.getUserId()).getAvatarVersion()))
                .toList();
        String myRole = parts.stream().filter(p -> p.userId().equals(viewer)).map(ParticipantDto::role).findFirst().orElse("MEMBER");
        return new RoomDto(room.getId(), room.getCode(), room.getName(), room.getCreatedAt(), room.getExpiresAt(),
                room.getOwnerId(), room.getOwnerId().equals(viewer), myRole, settings(room), parts);
    }

    private User user(UUID id) {
        return users.findById(id).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
    }

    private void destroy(Room room, String reason) {
        notifications.purgeRoom(room.getCode());
        files.deleteAllForRoom(room.getId());
        uploads.abortAllForRoom(room.getId());
        rooms.delete(room);
        events.publishEvent(new RoomEvent(room.getId(), "room.closed", Map.of("reason", reason, "name", room.getName())));
    }

    /** Estado de la sala para quien participa, aunque ya haya expirado (el resto de endpoints responden «expirada»). */
    @Transactional(readOnly = true)
    public RoomStatus status(UUID userId, String code) {
        Room room = rooms.findByCode(normalize(code)).orElseThrow(() -> ApiException.notFound("Sala no encontrada"));
        if (!members.existsById(new RoomMember.Key(room.getId(), userId))) throw ApiException.forbidden("No participas en esta sala");
        return new RoomStatus(room.getCode(), room.getName(), room.isExpired(), room.isExpired() && room.isKeepWhenExpired(), room.isKeepWhenExpired(), room.getOwnerId().equals(userId), room.getExpiresAt());
    }

    /** El propietario devuelve a la vida una sala inactiva (con una nueva duración, o sin expiración). Cuenta como sala activa de su cuenta. */
    @Transactional
    public RoomDto reactivate(UUID userId, Role role, String code, ReactivateRequest req) {
        Room room = rooms.findByCode(normalize(code)).orElseThrow(() -> ApiException.notFound("Sala no encontrada"));
        if (!room.getOwnerId().equals(userId) && role != Role.ADMIN) throw ApiException.forbidden("Solo el propietario puede reactivar la sala");
        if (!room.isExpired()) throw ApiException.conflict("La sala ya está activa");
        User owner = user(room.getOwnerId());
        Instant now = Instant.now();
        if (role != Role.ADMIN && owner.getMaxActiveRooms() != null && rooms.countActiveByOwner(owner.getId(), now) >= owner.getMaxActiveRooms()) {
            throw ApiException.forbidden("Has alcanzado el máximo de salas activas (" + owner.getMaxActiveRooms() + ")");
        }
        Integer limit = role == Role.ADMIN ? null : owner.getMaxRoomMinutes();
        int minutes = req == null || req.minutes() == null ? DEFAULT_MINUTES : req.minutes();
        if (minutes == 0) {
            if (limit != null) throw ApiException.forbidden("Tu cuenta no permite salas sin expiración");
            room.setExpiresAt(null);
        } else {
            if (limit != null && minutes > limit) throw ApiException.forbidden("Tu cuenta permite salas de hasta " + limit + " minutos");
            room.setExpiresAt(now.plus(Duration.ofMinutes(minutes)));
        }
        room.setInactiveSince(null);
        rooms.save(room);
        events.publishEvent(new RoomEvent(room.getId(), "room.reactivated", Map.of("name", room.getName(), "code", room.getCode())));
        publishUpdate(room);
        return toDto(room, userId);
    }

    /** Las salas con «mantener» que acaban de expirar pasan a inactivas: no se borra nada, pero se cierran las sesiones en vivo. */
    @Scheduled(fixedDelay = 60_000, initialDelay = 20_000)
    @Transactional
    public void deactivateExpiredKept() {
        for (Room room : rooms.findNewlyInactive(Instant.now())) {
            room.setInactiveSince(Instant.now());
            rooms.save(room);
            events.publishEvent(new RoomEvent(room.getId(), "room.inactive", Map.of("name", room.getName(), "code", room.getCode())));
            log.info("Sala conservada y dejada inactiva: {}", room.getCode());
        }
    }

    /** Las salas expiradas (sin «mantener») se destruyen junto con todos sus archivos. */
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
