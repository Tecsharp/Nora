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
    static final String FLOW_COOKIE = "nora_oauth";

    private final AuthService auth;
    private final AppProperties props;
    private final SettingsService settings;
    private final UserRepository users;
    private final GoogleAuthService google;

    public AuthController(AuthService auth, AppProperties props, SettingsService settings, UserRepository users, GoogleAuthService google) {
        this.google = google;
        this.auth = auth;
        this.props = props;
        this.settings = settings;
        this.users = users;
    }

    @GetMapping("/config")
    public Map<String, Object> config() {
        return Map.of(
                "registrationEnabled", settings.registrationEnabled(),
                "passwordLogin", settings.passwordLogin(),
                "googleLogin", settings.googleLogin());
    }

    /** Manda a la persona a Google. Es una navegación (no una llamada de la API): vuelve por {@link #googleCallback}. */
    @GetMapping("/google/start")
    public ResponseEntity<Void> googleStart(@RequestParam(defaultValue = "true") boolean remember, HttpServletRequest http) {
        try {
            var s = google.start(http, remember);
            return ResponseEntity.status(HttpStatus.FOUND)
                    .header(HttpHeaders.LOCATION, s.url())
                    .header(HttpHeaders.SET_COOKIE, flowCookie(s.flow().encode(), GoogleAuthService.flowTtl(), http).toString())
                    .header(HttpHeaders.CACHE_CONTROL, "no-store")
                    .build();
        } catch (OAuthError e) {
            return loginError(e.code(), http);
        }
    }

    @GetMapping("/google/callback")
    public ResponseEntity<Void> googleCallback(@RequestParam(required = false) String code, @RequestParam(required = false) String state,
                                               @RequestParam(required = false) String error,
                                               @CookieValue(name = FLOW_COOKIE, required = false) String flowCookie, HttpServletRequest http) {
        try {
            var flow = GoogleAuthService.Flow.decode(flowCookie);
            var identity = google.finish(http, code, state, error, flow);
            var s = auth.loginWithGoogle(identity, flow.remember(), http.getHeader(HttpHeaders.USER_AGENT));
            return ResponseEntity.status(HttpStatus.FOUND)
                    .header(HttpHeaders.LOCATION, "/")
                    .header(HttpHeaders.SET_COOKIE, cookie(s.refreshToken(), s.ttl(), http).toString())
                    .header(HttpHeaders.SET_COOKIE, flowCookie("", Duration.ZERO, http).toString())
                    .header(HttpHeaders.CACHE_CONTROL, "no-store")
                    .build();
        } catch (OAuthError e) {
            return loginError(e.code(), http);
        }
    }

    private ResponseEntity<Void> loginError(String code, HttpServletRequest http) {
        return ResponseEntity.status(HttpStatus.FOUND)
                .header(HttpHeaders.LOCATION, "/login?error=" + code)
                .header(HttpHeaders.SET_COOKIE, flowCookie("", Duration.ZERO, http).toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .build();
    }

    /** Lax (no Strict): Google devuelve a la persona con una navegación desde otro sitio, y con Strict el navegador no mandaría la cookie. */
    private ResponseCookie flowCookie(String value, Duration maxAge, HttpServletRequest http) {
        return ResponseCookie.from(FLOW_COOKIE, value)
                .httpOnly(true)
                .secure(props.cookieSecure() || http.isSecure())
                .sameSite("Lax")
                .path("/api/auth/google")
                .maxAge(maxAge)
                .build();
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
