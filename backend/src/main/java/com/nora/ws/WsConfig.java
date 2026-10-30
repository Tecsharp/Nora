package com.nora.ws;

import com.nora.assist.AssistService;
import com.nora.config.AppProperties;
import org.springframework.web.socket.server.HandshakeInterceptor;
import com.nora.user.UserRepository;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
public class WsConfig implements WebSocketConfigurer {

    private final NoraWebSocketHandler handler;
    private final AgentWebSocketHandler agentHandler;
    private final AssistService assist;
    private final WsTicketService tickets;
    private final UserRepository users;
    private final AppProperties props;

    public WsConfig(NoraWebSocketHandler handler, AgentWebSocketHandler agentHandler, AssistService assist, WsTicketService tickets, UserRepository users, AppProperties props) {
        this.handler = handler;
        this.agentHandler = agentHandler;
        this.assist = assist;
        this.tickets = tickets;
        this.users = users;
        this.props = props;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        List<String> origins = props.allowedOrigins() == null ? List.of()
                : props.allowedOrigins().stream().map(String::trim).filter(s -> !s.isEmpty()).toList();
        // El mismo origen (el del gateway) siempre se acepta; NORA_ALLOWED_ORIGINS añade otros.
        registry.addHandler(handler, "/ws")
                .addInterceptors(new WsHandshakeInterceptor(tickets, users))
                .setAllowedOrigins(origins.toArray(String[]::new));
        // El agente de escritorio (no es un navegador): se autentica con su token en la cabecera Authorization.
        registry.addHandler(agentHandler, "/ws/agent")
                .addInterceptors(new HandshakeInterceptor() {
                    @Override
                    public boolean beforeHandshake(org.springframework.http.server.ServerHttpRequest request, org.springframework.http.server.ServerHttpResponse response, org.springframework.web.socket.WebSocketHandler h, java.util.Map<String, Object> attributes) {
                        String auth = request.getHeaders().getFirst("Authorization");
                        var user = auth != null && auth.startsWith("Bearer ") ? assist.userForAgentToken(auth.substring(7).trim()).orElse(null) : null;
                        if (user == null) {
                            response.setStatusCode(org.springframework.http.HttpStatus.UNAUTHORIZED);
                            return false;
                        }
                        attributes.put("userId", user.getId());
                        return true;
                    }

                    @Override
                    public void afterHandshake(org.springframework.http.server.ServerHttpRequest request, org.springframework.http.server.ServerHttpResponse response, org.springframework.web.socket.WebSocketHandler h, Exception ex) {}
                });
    }

    @Bean
    ServletServerContainerFactoryBean webSocketContainer() {
        var c = new ServletServerContainerFactoryBean();
        c.setMaxTextMessageBufferSize(2 * 1024 * 1024); // cambios de documentos (con imágenes) en base64
        c.setMaxBinaryMessageBufferSize(1024);
        // Los clientes envían un ping cada 25 s; una conexión muda (p. ej. un túnel caído) se libera sola.
        c.setMaxSessionIdleTimeout(90_000L);
        return c;
    }
}
