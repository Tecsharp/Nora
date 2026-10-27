package com.nora.ws;

import com.nora.user.User;
import com.nora.user.UserRepository;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

/** Autentica el handshake con el ticket de un solo uso (?ticket=…). */
public class WsHandshakeInterceptor implements HandshakeInterceptor {

    private final WsTicketService tickets;
    private final UserRepository users;

    public WsHandshakeInterceptor(WsTicketService tickets, UserRepository users) {
        this.tickets = tickets;
        this.users = users;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler,
                                   Map<String, Object> attributes) {
        String ticket = request instanceof ServletServerHttpRequest s ? s.getServletRequest().getParameter("ticket") : null;
        UUID userId = tickets.consume(ticket).orElse(null);
        User user = userId == null ? null : users.findById(userId).filter(User::isEnabled).orElse(null);
        if (user == null) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        attributes.put("userId", user.getId());
        attributes.put("displayName", user.getDisplayName());
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler, Exception ex) {}
}
