package com.nora.call;

import com.nora.auth.AuthPrincipal;
import com.nora.user.UserRepository;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CallController {

    public record CreateCall(String title, String access) {}

    private final CallService calls;
    private final UserRepository users;

    public CallController(CallService calls, UserRepository users) {
        this.calls = calls;
        this.users = users;
    }

    private String name(UUID userId) {
        return users.findById(userId).map(u -> u.getDisplayName()).orElse("Alguien");
    }

    /** Llamadas abiertas de la sala y las últimas que terminaron. */
    @GetMapping("/api/rooms/{code}/calls")
    public Map<String, Object> list(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        return calls.list(p.userId(), code);
    }

    @PostMapping("/api/rooms/{code}/calls")
    public CallService.CallDto create(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @RequestBody(required = false) CreateCall req) {
        return calls.create(p.userId(), name(p.userId()), code, req == null ? "" : req.title(), req == null ? null : req.access());
    }

    /** Datos de una llamada por su código (solo para personas de su sala). */
    @GetMapping("/api/calls/{code}")
    public CallService.CallDto info(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        return calls.info(p.userId(), code);
    }

    @PostMapping("/api/calls/{code}/end")
    public CallService.CallDto end(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        return calls.end(p.userId(), code);
    }

    /** Crea el chat de la llamada (aparece en Mensajes) o devuelve el que ya existe. */
    @PostMapping("/api/calls/{code}/chat")
    public Map<String, Object> chat(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        return Map.of("conversationId", calls.createChat(p.userId(), name(p.userId()), code));
    }
}
