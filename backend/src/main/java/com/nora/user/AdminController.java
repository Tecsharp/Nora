package com.nora.user;

import com.nora.auth.AuthPrincipal;
import com.nora.common.ApiException;
import com.nora.file.FileService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import com.nora.ws.UserEvent;
import java.util.List;
import java.util.Map;
import org.springframework.context.ApplicationEventPublisher;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/users")
public class AdminController {

    /** null en cualquier límite = infinito. */
    public record UpdateUserRequest(
            Role role,
            Boolean enabled,
            @Min(0) Long storageQuotaBytes,
            @Min(0) Long maxFileSizeBytes,
            @Min(1) Integer maxRoomMinutes,
            @Min(0) Integer maxActiveRooms,
            @Min(1) Integer maxParticipants) {}

    public record AdminUserView(UserDto user, long storageUsedBytes) {}

    private final UserRepository users;
    private final FileService files;
    private final ApplicationEventPublisher events;

    public AdminController(UserRepository users, FileService files, ApplicationEventPublisher events) {
        this.users = users;
        this.files = files;
        this.events = events;
    }

    public record UserPage(List<AdminUserView> items, long total, int page, int size) {}

    /** Listado paginado con búsqueda por nombre o email y filtro opcional por rol. */
    @GetMapping
    @Transactional(readOnly = true)
    public UserPage list(@RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size,
                         @RequestParam(defaultValue = "") String q, @RequestParam(required = false) Role role) {
        int safeSize = Math.max(1, Math.min(size, 100));
        String term = q.trim().toLowerCase().replace("!", "!!").replace("%", "!%").replace("_", "!_");
        var result = users.search(term, role,
                org.springframework.data.domain.PageRequest.of(Math.max(0, page), safeSize,
                        org.springframework.data.domain.Sort.by("createdAt").ascending()));
        return new UserPage(result.getContent().stream()
                .map(u -> new AdminUserView(UserDto.of(u), files.usedBytes(u.getId()))).toList(),
                result.getTotalElements(), result.getNumber(), safeSize);
    }

    /** PUT: los límites se reemplazan por completo, así que un campo ausente (null) significa "infinito". */
    @PutMapping("/{id}")
    @Transactional
    public AdminUserView update(@PathVariable UUID id, @Valid @RequestBody UpdateUserRequest req,
                                @AuthenticationPrincipal AuthPrincipal me) {
        User u = users.findById(id).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
        boolean self = u.getId().equals(me.userId());
        if (self && Boolean.FALSE.equals(req.enabled())) throw ApiException.badRequest("No puedes desactivarte a ti mismo");
        if (self && req.role() != null && req.role() != Role.ADMIN) throw ApiException.badRequest("No puedes quitarte el rol de administrador");
        if (req.role() != null) u.setRole(req.role());
        if (req.enabled() != null) u.setEnabled(req.enabled());
        u.setStorageQuotaBytes(req.storageQuotaBytes());
        u.setMaxFileSizeBytes(req.maxFileSizeBytes());
        u.setMaxRoomMinutes(req.maxRoomMinutes());
        u.setMaxActiveRooms(req.maxActiveRooms());
        u.setMaxParticipants(req.maxParticipants());
        User saved = users.save(u);
        if (!saved.isEnabled()) {
            events.publishEvent(new UserEvent(saved.getId(), "account.disabled", Map.of("message", "Tu cuenta ha sido desactivada")));
        } else if (!self) {
            events.publishEvent(new UserEvent(saved.getId(), "account.updated",
                    Map.of("message", "Un administrador ha actualizado los límites de tu cuenta", "user", UserDto.of(saved))));
        }
        return new AdminUserView(UserDto.of(saved), files.usedBytes(saved.getId()));
    }
}
