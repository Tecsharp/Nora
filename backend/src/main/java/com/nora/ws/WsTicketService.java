package com.nora.ws;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Tickets de un solo uso para abrir el WebSocket. El navegador no puede enviar la cabecera Authorization en un
 * WebSocket, y poner el JWT en la URL lo dejaría en logs y proxies: se canjea por un ticket que caduca a los 30 s.
 */
@Service
public class WsTicketService {

    public static final Duration TTL = Duration.ofSeconds(30);
    private static final int MAX_PENDING = 10_000;

    private record Entry(UUID userId, Instant expires) {}

    private final Map<String, Entry> tickets = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    public String issue(UUID userId) {
        if (tickets.size() >= MAX_PENDING) purge();
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String ticket = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        tickets.put(ticket, new Entry(userId, Instant.now().plus(TTL)));
        return ticket;
    }

    /** Consume el ticket: solo sirve una vez. */
    public Optional<UUID> consume(String ticket) {
        if (ticket == null) return Optional.empty();
        Entry e = tickets.remove(ticket);
        if (e == null || e.expires().isBefore(Instant.now())) return Optional.empty();
        return Optional.of(e.userId());
    }

    @Scheduled(fixedDelay = 60_000)
    void purge() {
        Instant now = Instant.now();
        tickets.values().removeIf(e -> e.expires().isBefore(now));
    }
}
