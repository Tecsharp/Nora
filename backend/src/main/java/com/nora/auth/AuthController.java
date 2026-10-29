package com.nora.auth;

import com.nora.auth.AuthDtos.*;
import com.nora.config.AppProperties;
import com.nora.config.SettingsService;
import com.nora.user.UserDto;
import com.nora.user.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.time.Duration;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    static final String COOKIE = "nora_refresh";

    private final AuthService auth;
    private final AppProperties props;
    private final SettingsService settings;
    private final UserRepository users;

    public AuthController(AuthService auth, AppProperties props, SettingsService settings, UserRepository users) {
        this.auth = auth;
        this.props = props;
        this.settings = settings;
        this.users = users;
    }

    @GetMapping("/config")
    public Map<String, Object> config() {
        return Map.of("registrationEnabled", settings.registrationEnabled());
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public UserDto register(@Valid @RequestBody RegisterRequest req) {
        return UserDto.of(auth.register(req));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest req, HttpServletRequest http) {
        return withCookie(auth.login(req, http.getHeader(HttpHeaders.USER_AGENT)), http);
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(@CookieValue(name = COOKIE, required = false) String token, HttpServletRequest http) {
        return withCookie(auth.refresh(token, http.getHeader(HttpHeaders.USER_AGENT)), http);
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@CookieValue(name = COOKIE, required = false) String token, HttpServletRequest http) {
        auth.logout(token);
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO, http).toString()).build();
    }

    /** Datos del enlace para cambiar la contraseña (a quién pertenece y cuándo caduca). */
    @GetMapping("/reset/{token}")
    public Map<String, Object> resetInfo(@PathVariable String token) {
        return auth.resetInfo(token);
    }

    @PostMapping("/reset")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void reset(@Valid @RequestBody ResetRequest req) {
        auth.resetPassword(req.token(), req.password());
    }

    private ResponseEntity<AuthResponse> withCookie(AuthService.Session s, HttpServletRequest http) {
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie(s.refreshToken(), s.ttl(), http).toString())
                .body(s.response());
    }

    /** Secure si se fuerza por configuración o si el cliente entra por HTTPS (según X-Forwarded-Proto del gateway). `maxAge` null = cookie de sesión. */
    private ResponseCookie cookie(String value, Duration maxAge, HttpServletRequest http) {
        var b = ResponseCookie.from(COOKIE, value)
                .httpOnly(true)
                .secure(props.cookieSecure() || http.isSecure())
                .sameSite("Strict")
                .path("/api/auth");
        if (maxAge != null) b.maxAge(maxAge);
        return b.build();
    }
}
