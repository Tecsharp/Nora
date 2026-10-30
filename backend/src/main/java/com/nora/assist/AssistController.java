package com.nora.assist;

import com.nora.auth.AuthPrincipal;
import com.nora.common.ApiException;
import com.nora.config.AppProperties;
import com.nora.room.RoomService;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/assist")
public class AssistController {

    private final AssistService assist;
    private final RoomService rooms;
    private final AppProperties props;

    public AssistController(AssistService assist, RoomService rooms, AppProperties props) {
        this.assist = assist;
        this.rooms = rooms;
        this.props = props;
    }

    /** Dónde descargar el agente en cada sistema (vacío = no configurado: la interfaz busca el archivo en /downloads/). */
    @GetMapping("/agent/downloads")
    public Map<String, String> downloads() {
        var a = props.agent();
        return Map.of("windows", clean(a == null ? null : a.urlWindows()), "macos", clean(a == null ? null : a.urlMacos()), "linux", clean(a == null ? null : a.urlLinux()));
    }

    /** Solo enlaces http(s): lo que venga del .env no puede ser un javascript: ni nada parecido. */
    private static String clean(String url) {
        String u = url == null ? "" : url.strip();
        return u.startsWith("https://") || u.startsWith("http://") ? u : "";
    }

    /** Servidores STUN/TURN para la conexión directa entre los dos navegadores. */
    @GetMapping("/ice")
    public Map<String, Object> ice(@AuthenticationPrincipal AuthPrincipal p) {
        return Map.of("iceServers", assist.iceServers(p.userId()));
    }

    /** ¿Tiene esta persona su agente de escritorio conectado? */
    @GetMapping("/agent")
    public Map<String, Object> agent(@AuthenticationPrincipal AuthPrincipal p) {
        return assist.agentInfo(p.userId());
    }

    /** Código de un solo uso para vincular el agente de escritorio con esta cuenta. */
    @PostMapping("/agent/code")
    public Map<String, Object> code(@AuthenticationPrincipal AuthPrincipal p) {
        return Map.of("code", assist.newPairCode(p.userId()), "expiresInSeconds", 600);
    }

    public record PairRequest(String code) {}

    /** Lo llama el agente (no el navegador): canjea el código por su token. Sin sesión, con límite de intentos. */
    @PostMapping("/agent/pair")
    public Map<String, Object> pair(@RequestBody PairRequest req) {
        String token = assist.pair(req.code()).orElseThrow(() -> ApiException.badRequest("Código no válido o caducado"));
        return Map.of("token", token);
    }

    /** Quién de esta sala tiene el agente conectado (a esas personas se les puede pedir el control). */
    @GetMapping("/rooms/{code}/agents")
    public Map<String, Object> roomAgents(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        List<String> ids = rooms.get(p.userId(), code).participants().stream()
                .filter(x -> assist.agentOnline(x.userId())).map(x -> x.userId().toString()).toList();
        return Map.of("userIds", ids);
    }
}
