package com.nora.auth;

import com.nora.auth.AuthDtos.*;
import com.nora.config.AppProperties;
import com.nora.user.UserDto;
import com.nora.user.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.time.Duration;
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
    private final UserRepository users;

    public AuthController(AuthService auth, AppProperties props, UserRepository users) {
        this.auth = auth;
        this.props = props;
        this.users = users;
    }

    @GetMapping("/config")
    public java.util.Map<String, Object> config() {
        return java.util.Map.of("registrationEnabled", props.allowRegistration());
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public UserDto register(@Valid @RequestBody RegisterRequest req) {
        return UserDto.of(auth.register(req));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest req, HttpServletRequest http) {
        return withCookie(auth.login(req), http);
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(@CookieValue(name = COOKIE, required = false) String token, HttpServletRequest http) {
        return withCookie(auth.refresh(token), http);
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@CookieValue(name = COOKIE, required = false) String token, HttpServletRequest http) {
        auth.logout(token);
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO, http).toString()).build();
    }

    private ResponseEntity<AuthResponse> withCookie(AuthService.Session s, HttpServletRequest http) {
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE,
                        cookie(s.refreshToken(), Duration.ofDays(props.jwt().refreshTtlDays()), http).toString())
                .body(s.response());
    }

    /** Secure si se fuerza por configuración o si el cliente entra por HTTPS (según X-Forwarded-Proto del gateway). */
    private ResponseCookie cookie(String value, Duration maxAge, HttpServletRequest http) {
        return ResponseCookie.from(COOKIE, value)
                .httpOnly(true)
                .secure(props.cookieSecure() || http.isSecure())
                .sameSite("Strict")
                .path("/api/auth")
                .maxAge(maxAge)
                .build();
    }
}
