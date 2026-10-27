package com.nora.auth;

import com.nora.auth.AuthDtos.*;
import com.nora.common.ApiException;
import com.nora.config.AppProperties;
import com.nora.user.Role;
import com.nora.user.User;
import com.nora.user.UserDto;
import com.nora.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private static final int MAX_FAILED_ATTEMPTS = 5;
    private static final Duration LOCK_TIME = Duration.ofMinutes(15);

    private final UserRepository users;
    private final RefreshTokenRepository refreshTokens;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final AppProperties props;
    private final SecureRandom random = new SecureRandom();
    /** Evita distinguir "usuario inexistente" por tiempo de respuesta. */
    private final String dummyHash;

    public AuthService(UserRepository users, RefreshTokenRepository refreshTokens, PasswordEncoder encoder,
                       JwtService jwt, AppProperties props) {
        this.users = users;
        this.refreshTokens = refreshTokens;
        this.encoder = encoder;
        this.jwt = jwt;
        this.props = props;
        this.dummyHash = encoder.encode("nora-dummy-password");
    }

    public record Session(AuthResponse response, String refreshToken) {}

    @Transactional
    public User register(RegisterRequest req) {
        if (!props.allowRegistration()) {
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
        var d = props.defaults();
        u.setStorageQuotaBytes(d.storageQuotaMb() * 1024 * 1024);
        u.setMaxFileSizeBytes(d.maxFileMb() * 1024 * 1024);
        u.setMaxRoomMinutes(d.maxRoomMinutes());
        u.setMaxActiveRooms(d.maxActiveRooms());
        u.setMaxParticipants(d.maxParticipants());
        return users.save(u);
    }

    @Transactional(noRollbackFor = ApiException.class)
    public Session login(LoginRequest req) {
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
        return issue(user);
    }

    @Transactional(noRollbackFor = ApiException.class)
    public Session refresh(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) throw unauthorized();
        RefreshToken stored = refreshTokens.findByTokenHash(hash(rawToken)).orElseThrow(AuthService::unauthorized);
        if (stored.isRevoked()) {
            // Reutilización de un token ya rotado: se asume robo y se cierran todas las sesiones del usuario.
            refreshTokens.revokeAllForUser(stored.getUserId());
            throw unauthorized();
        }
        if (stored.getExpiresAt().isBefore(Instant.now())) throw unauthorized();
        stored.setRevoked(true);
        User user = users.findById(stored.getUserId()).filter(User::isEnabled).orElseThrow(AuthService::unauthorized);
        return issue(user);
    }

    @Transactional
    public void logout(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) return;
        refreshTokens.findByTokenHash(hash(rawToken)).ifPresent(t -> t.setRevoked(true));
    }

    private Session issue(User user) {
        byte[] bytes = new byte[48];
        random.nextBytes(bytes);
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        refreshTokens.save(new RefreshToken(user.getId(), hash(raw),
                Instant.now().plus(Duration.ofDays(props.jwt().refreshTtlDays()))));
        var response = new AuthResponse(jwt.createAccessToken(user.getId(), user.getRole()),
                jwt.accessTtlSeconds(), UserDto.of(user));
        return new Session(response, raw);
    }

    @Scheduled(fixedDelay = 3_600_000, initialDelay = 60_000)
    @Transactional
    public void purgeExpiredTokens() {
        refreshTokens.deleteExpired(Instant.now());
    }

    private static String hash(String raw) {
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
