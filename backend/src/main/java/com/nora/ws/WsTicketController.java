package com.nora.ws;

import com.nora.auth.AuthPrincipal;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ws")
public class WsTicketController {

    private final WsTicketService tickets;

    public WsTicketController(WsTicketService tickets) {
        this.tickets = tickets;
    }

    @PostMapping("/ticket")
    public Map<String, Object> ticket(@AuthenticationPrincipal AuthPrincipal p) {
        return Map.of("ticket", tickets.issue(p.userId()), "expiresInSeconds", WsTicketService.TTL.toSeconds());
    }
}
