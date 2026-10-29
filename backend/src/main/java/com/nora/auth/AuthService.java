package com.nora.auth;

import com.nora.auth.AuthDtos.*;
import com.nora.common.ApiException;
import com.nora.config.AppProperties;
import com.nora.config.SettingsService;
import com.nora.user.Role;
import com.nora.user.User;
import com.nora.user.UserDto;
import com.nora.user.UserRepository;
import com.nora.ws.UserEvent;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private static final int MAX_FAILED_ATTEMPTS = 5;
    private static final Duration LOCK_TIME = Duration.ofMinutes(15);
    /** Con «recordarme» la sesión dura un mes. */
    public static final Duration REMEMBER_TTL = Duration.ofDays(30);
    private static final Duration RESET_TTL = Duration.ofHours(24);
    private static final java.util.regex.Pattern PASSWORD_RULE = java.util.regex.Pattern.compile("^(?=.*\\p{Lu})(?=.*\\p{Ll})(?=.*\\d).*$");

    private final UserRepository users;
    private final RefreshTokenRepository refreshTokens;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final AppProperties props;
    private final SettingsService settings;
    private final JdbcTemplate jdbc;
    private final ApplicationEventPublisher events;
    private final SecureRandom random = new SecureRandom();
    /** Evita distinguir "usuario inexistente" por tiempo de respuesta. */
    private final String dummyHash;

    public AuthService(UserRepository users, RefreshTokenRepository refreshTokens, PasswordEncoder encoder,
                       JwtService jwt, AppProperties props, SettingsService settings, JdbcTemplate jdbc, ApplicationEventPublisher events) {
        this.users = users;
        this.refreshTokens = refreshTokens;
        this.encoder = encoder;
        this.jwt = jwt;
        this.props = props;
        this.settings = settings;
        this.jdbc = jdbc;
        this.events = events;
        this.dummyHash = encoder.encode("nora-dummy-password");
    }

    /** `ttl` null = cookie de sesión (acaba al cerrar el navegador). */
    public record Session(AuthResponse response, String refreshToken, Duration ttl) {}

    public record SessionInfo(UUID id, Instant startedAt, Instant lastUsedAt, String device, boolean remember, boolean current) {}

    @Transactional
    public User register(RegisterRequest req) {
        if (!settings.registrationEnabled()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "El registro está desactivado");
        }
        return createUser(req.email(), req.displayName(), req.password(), Role.USER);
    }

    @Transactional
    public User createUser(String email, String displayName, String rawPassword, Role role) {
        String normalized = email.trim().toLowerCase(Locale.ROOT);
        if (users.existsByEmail(normalized)) {
            throw ApiException.conflict("Ya existe una cuenta con ese email");
        }
        User u = new User(normalized, displayName.trim(), encoder.encode(rawPassword), role);
        var d = settings.defaults();
        u.setStorageQuotaBytes(d.storageQuotaMb() * 1024 * 1024);
        u.setMaxFileSizeBytes(d.maxFileMb() * 1024 * 1024);
        u.setMaxRoomMinutes(d.maxRoomMinutes());
        u.setMaxActiveRooms(d.maxActiveRooms());
        u.setMaxParticipants(d.maxParticipants());
        return users.save(u);
    }

    @Transactional(noRollbackFor = ApiException.class)
    public Session login(LoginRequest req, String userAgent) {
        User user = users.findByEmail(req.email().trim().toLowerCase(Locale.ROOT)).orElse(null);
        if (user == null) {
            encoder.matches(req.password(), dummyHash);
            throw invalid();
        }
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(Instant.now())) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "Cuenta bloqueada temporalmente. Inténtalo más tarde");
        }
        if (!encoder.matches(req.password(), user.getPasswordHash())) {
            int attempts = user.getFailedAttempts() + 1;
            user.setFailedAttempts(attempts);
            if (attempts >= MAX_FAILED_ATTEMPTS) {
                user.setLockedUntil(Instant.now().plus(LOCK_TIME));
                user.setFailedAttempts(0);
            }
            throw invalid();
        }
        if (!user.isEnabled()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Cuenta desactivada");
        }
        user.setFailedAttempts(0);
        user.setLockedUntil(null);
        user.setLastLoginAt(Instant.now());
        return issue(user, Boolean.TRUE.equals(req.remember()), userAgent, Instant.now());
    }

    @Transactional(noRollbackFor = ApiException.class)
    public Session refresh(String rawToken, String userAgent) {
        if (rawToken == null || rawToken.isBlank()) throw unauthorized();
        RefreshToken stored = refreshTokens.findByTokenHash(hash(rawToken)).orElseThrow(AuthService::unauthorized);
        if (stored.isRevoked()) {
            // Reutilización de un token ya rotado: se asume robo y se cierran todas las sesiones del usuario.
            // Un token cerrado a propósito (cerrar sesión, «cerrar las demás») solo se rechaza.
            if (stored.isRotated()) refreshTokens.revokeAllForUser(stored.getUserId());
            throw unauthorized();
        }
        if (stored.getExpiresAt().isBefore(Instant.now())) throw unauthorized();
        stored.setRevoked(true);
        stored.setRotated(true);
        User user = users.findById(stored.getUserId()).filter(User::isEnabled).orElseThrow(AuthService::unauthorized);
        return issue(user, stored.isRemember(), stored.getUserAgent() != null ? stored.getUserAgent() : userAgent,
                stored.getStartedAt() != null ? stored.getStartedAt() : stored.getCreatedAt());
    }

    @Transactional
    public void logout(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) return;
        refreshTokens.findByTokenHash(hash(rawToken)).ifPresent(t -> t.setRevoked(true));
    }

    private Session issue(User user, boolean remember, String userAgent, Instant startedAt) {
        byte[] bytes = new byte[48];
        random.nextBytes(bytes);
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Duration ttl = remember ? REMEMBER_TTL : Duration.ofDays(props.jwt().refreshTtlDays());
        RefreshToken t = new RefreshToken(user.getId(), hash(raw), Instant.now().plus(ttl));
        t.setRemember(remember);
        t.setUserAgent(userAgent);
        t.setStartedAt(startedAt);
        t.setLastUsedAt(Instant.now());
        refreshTokens.save(t);
        var response = new AuthResponse(jwt.createAccessToken(user.getId(), user.getRole()), jwt.accessTtlSeconds(), UserDto.of(user));
        return new Session(response, raw, remember ? ttl : null);
    }

    // ---- sesiones ----

    @Transactional(readOnly = true)
    public List<SessionInfo> sessions(UUID userId, String currentRaw) {
        String current = currentRaw == null || currentRaw.isBlank() ? "" : hash(currentRaw);
        return refreshTokens.active(userId, Instant.now()).stream()
                .map(t -> new SessionInfo(t.getId(), t.getStartedAt() != null ? t.getStartedAt() : t.getCreatedAt(), t.getLastUsedAt(), t.getUserAgent(), t.isRemember(), t.getTokenHash().equals(current)))
                .toList();
    }

    @Transactional
    public void revokeSession(UUID userId, UUID sessionId) {
        RefreshToken t = refreshTokens.findById(sessionId).filter(x -> x.getUserId().equals(userId)).orElseThrow(() -> ApiException.notFound("Sesión no encontrada"));
        t.setRevoked(true);
    }

    /** Cierra todas las sesiones salvo la actual (la del token dado). */
    @Transactional
    public void revokeOthers(UUID userId, String currentRaw) {
        refreshTokens.revokeOthers(userId, currentRaw == null || currentRaw.isBlank() ? "" : hash(currentRaw));
    }

    /** Cierre de sesión forzado: ni los tokens de renovación ni los de acceso ya emitidos valen, y se corta el tiempo real. */
    @Transactional
    public void forceLogout(UUID userId, String message) {
        User u = users.findById(userId).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
        refreshTokens.revokeAllForUser(userId);
        u.setTokensValidAfter(Instant.now());
        events.publishEvent(new UserEvent(userId, "account.revoked", Map.of("message", message)));
    }

    // ---- contraseña ----

    public static void checkPassword(String pw) {
        if (pw == null || pw.length() < 10 || pw.length() > 72) throw ApiException.badRequest("La contraseña debe tener entre 10 y 72 caracteres");
        if (!PASSWORD_RULE.matcher(pw).matches()) throw ApiException.badRequest("La contraseña necesita mayúscula, minúscula y número");
    }

    @Transactional
    public void changePassword(UUID userId, String current, String next, String currentRaw) {
        User u = users.findById(userId).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
        if (!encoder.matches(current == null ? "" : current, u.getPasswordHash())) throw ApiException.badRequest("La contraseña actual no es correcta");
        checkPassword(next);
        u.setPasswordHash(encoder.encode(next));
        revokeOthers(userId, currentRaw); // el resto de dispositivos tiene que volver a entrar
    }

    /** Comprueba la contraseña de quien pide una acción delicada (cambiar el correo, borrar la cuenta). */
    @Transactional(readOnly = true)
    public void requirePassword(UUID userId, String password) {
        User u = users.findById(userId).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
        if (!encoder.matches(password == null ? "" : password, u.getPasswordHash())) throw ApiException.badRequest("La contraseña no es correcta");
    }

    // ---- enlaces para cambiar la contraseña (los genera un administrador) ----

    public record ResetLink(String token, Instant expiresAt) {}

    @Transactional
    public ResetLink createResetLink(UUID adminId, UUID targetId) {
        users.findById(targetId).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expires = Instant.now().plus(RESET_TTL);
        jdbc.update("update password_resets set used_at = now() where user_id = ? and used_at is null", targetId); // un enlace nuevo anula los anteriores
        jdbc.update("insert into password_resets (id, user_id, token_hash, expires_at, created_by, created_at) values (?,?,?,?,?,?)",
                UUID.randomUUID(), targetId, hash(raw), Timestamp.from(expires), adminId, Timestamp.from(Instant.now()));
        return new ResetLink(raw, expires);
    }

    private record ResetRow(UUID id, UUID userId, Instant expiresAt, boolean used) {}

    private ResetRow resetRow(String raw) {
        var rows = jdbc.query("select id, user_id, expires_at, used_at from password_resets where token_hash = ?",
                (r, i) -> new ResetRow(r.getObject(1, UUID.class), r.getObject(2, UUID.class), r.getTimestamp(3).toInstant(), r.getTimestamp(4) != null), hash(raw == null ? "" : raw));
        if (rows.isEmpty()) throw ApiException.notFound("Este enlace no es válido");
        ResetRow row = rows.get(0);
        if (row.used()) throw new ApiException(HttpStatus.GONE, "Este enlace ya se usó o fue sustituido por otro");
        if (row.expiresAt().isBefore(Instant.now())) throw new ApiException(HttpStatus.GONE, "Este enlace ha caducado. Pide uno nuevo al administrador");
        return row;
    }

    /** Para mostrar a quién pertenece el enlace antes de pedir la contraseña nueva. */
    @Transactional(readOnly = true)
    public Map<String, Object> resetInfo(String raw) {
        ResetRow row = resetRow(raw);
        User u = users.findById(row.userId()).orElseThrow(() -> ApiException.notFound("Este enlace no es válido"));
        return Map.of("displayName", u.getDisplayName(), "expiresAt", row.expiresAt());
    }

    @Transactional
    public void resetPassword(String raw, String next) {
        ResetRow row = resetRow(raw);
        checkPassword(next);
        User u = users.findById(row.userId()).orElseThrow(() -> ApiException.notFound("Este enlace no es válido"));
        u.setPasswordHash(encoder.encode(next));
        u.setFailedAttempts(0);
        u.setLockedUntil(null);
        jdbc.update("update password_resets set used_at = now() where id = ?", row.id());
        forceLogout(u.getId(), "Tu contraseña se cambió: vuelve a iniciar sesión");
    }

    @Scheduled(fixedDelay = 3_600_000, initialDelay = 60_000)
    @Transactional
    public void purgeExpiredTokens() {
        refreshTokens.deleteExpired(Instant.now());
        jdbc.update("delete from password_resets where expires_at < now() - interval '7 days'");
    }

    static String hash(String raw) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static ApiException invalid() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "Email o contraseña incorrectos");
    }

    private static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "Sesión no válida");
    }
}
