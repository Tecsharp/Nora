package com.nora.ai;

import com.nora.auth.AuthPrincipal;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
@RequestMapping("/api/ai")
public class AiController {

    private final AiService ai;

    public AiController(AiService ai) {
        this.ai = ai;
    }

    /** El navegador solo muestra las funciones de IA si esto dice enabled=true. */
    @GetMapping("/status")
    public Map<String, Object> status() {
        return Map.of("enabled", ai.active(), "provider", "DeepSeek", "model", ai.model());
    }

    /** Respuesta en streaming (text/event-stream): data: {"d": trozo} … data: {"done": true}. */
    @PostMapping(value = "/run", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<StreamingResponseBody> run(@AuthenticationPrincipal AuthPrincipal p, @RequestBody AiService.Request req) {
        // Todo error (límite, texto largo, DeepSeek caído…) viaja dentro del stream como {"error": mensaje}: así el navegador lo muestra tal cual.
        StreamingResponseBody body = out -> {
            try {
                ai.stream(p.userId(), req, out);
            } catch (com.nora.common.ApiException e) {
                ai.error(out, e.getMessage());
            }
        };
        return ResponseEntity.ok().header("Cache-Control", "no-cache").header("X-Accel-Buffering", "no").body(body);
    }
}
