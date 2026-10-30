package com.nora.notify;

import com.nora.auth.AuthPrincipal;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService notifications;

    public NotificationController(NotificationService notifications) {
        this.notifications = notifications;
    }

    @GetMapping
    public Map<String, Object> list(@AuthenticationPrincipal AuthPrincipal p, @RequestParam(defaultValue = "40") int limit) {
        return notifications.list(p.userId(), limit);
    }

    @PostMapping("/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void read(@AuthenticationPrincipal AuthPrincipal p, @PathVariable UUID id) {
        notifications.markRead(p.userId(), id);
    }

    @PostMapping("/read-all")
    public Map<String, Object> readAll(@AuthenticationPrincipal AuthPrincipal p) {
        return Map.of("marked", notifications.markAllRead(p.userId()));
    }
}
