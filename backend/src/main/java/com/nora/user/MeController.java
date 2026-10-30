package com.nora.user;

import com.nora.auth.AuthPrincipal;
import com.nora.auth.AuthService;
import com.nora.common.ApiException;
import com.nora.file.FileService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** La cuenta de quien tiene la sesión: perfil, foto, contraseña, sesiones y borrado. */
@RestController
public class MeController {

    public record ProfileRequest(@Size(max = 60) String displayName, @Size(max = 254) String email, @Size(max = 72) String currentPassword) {}
    public record PasswordRequest(@NotBlank @Size(max = 72) String currentPassword, @NotBlank @Size(max = 72) String newPassword) {}
    public record DeleteRequest(@NotBlank @Size(max = 72) String password) {}

    private final UserRepository users;
    private final FileService files;
    private final AccountService accounts;
    private final AuthService auth;

    public MeController(UserRepository users, FileService files, AccountService accounts, AuthService auth) {
        this.users = users;
        this.files = files;
        this.accounts = accounts;
        this.auth = auth;
    }

    @GetMapping("/api/me")
    public Map<String, Object> me(@AuthenticationPrincipal AuthPrincipal p) {
        User u = users.findById(p.userId()).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
        return Map.of("user", UserDto.of(u), "storageUsedBytes", files.usedBytes(u.getId()));
    }

    @PatchMapping("/api/me")
    public UserDto profile(@AuthenticationPrincipal AuthPrincipal p, @Valid @RequestBody ProfileRequest req) {
        User current = users.findById(p.userId()).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
        boolean emailChange = req.email() != null && !req.email().trim().equalsIgnoreCase(current.getEmail());
        if (emailChange) auth.requirePassword(p.userId(), req.currentPassword()); // el correo es el usuario de acceso
        return UserDto.of(accounts.updateProfile(p.userId(), req.displayName(), req.email()));
    }

    @PutMapping("/api/me/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void password(@AuthenticationPrincipal AuthPrincipal p, @Valid @RequestBody PasswordRequest req,
                         @CookieValue(name = "nora_refresh", required = false) String token) {
        auth.changePassword(p.userId(), req.currentPassword(), req.newPassword(), token);
    }

    @PutMapping("/api/me/avatar")
    public UserDto setAvatar(@AuthenticationPrincipal AuthPrincipal p, @RequestParam("file") MultipartFile file) throws IOException {
        return UserDto.of(accounts.setAvatar(p.userId(), file.getBytes()));
    }

    @DeleteMapping("/api/me/avatar")
    public UserDto removeAvatar(@AuthenticationPrincipal AuthPrincipal p) {
        return UserDto.of(accounts.removeAvatar(p.userId()));
    }

    /** La foto de cualquier persona (hace falta sesión). La URL lleva la versión, así que el navegador la guarda. */
    @GetMapping("/api/users/{id}/avatar")
    public ResponseEntity<byte[]> avatar(@PathVariable UUID id) {
        var a = accounts.avatar(id);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(a.contentType())).cacheControl(CacheControl.maxAge(java.time.Duration.ofDays(30)).cachePrivate())
                .header("X-Content-Type-Options", "nosniff").body(a.content());
    }

    @GetMapping("/api/me/sessions")
    public List<AuthService.SessionInfo> sessions(@AuthenticationPrincipal AuthPrincipal p, @CookieValue(name = "nora_refresh", required = false) String token) {
        return auth.sessions(p.userId(), token);
    }

    @DeleteMapping("/api/me/sessions/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void closeSession(@AuthenticationPrincipal AuthPrincipal p, @PathVariable UUID id) {
        auth.revokeSession(p.userId(), id);
    }

    @DeleteMapping("/api/me/sessions")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void closeOthers(@AuthenticationPrincipal AuthPrincipal p, @CookieValue(name = "nora_refresh", required = false) String token) {
        auth.revokeOthers(p.userId(), token);
    }

    /** Borra la cuenta y todos sus datos. Exige la contraseña. */
    @DeleteMapping("/api/me")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal AuthPrincipal p, @Valid @RequestBody DeleteRequest req) {
        auth.requirePassword(p.userId(), req.password());
        accounts.deleteAccount(p.userId());
    }
}
