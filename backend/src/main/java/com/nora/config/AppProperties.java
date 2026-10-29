package com.nora.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public record AppProperties(
        Jwt jwt,
        boolean cookieSecure,
        List<String> allowedOrigins,
        boolean allowRegistration,
        Admin admin,
        Defaults defaults,
        Storage storage,
        Converter converter,
        Ai ai) {

    public record Jwt(String secret, long accessTtlMinutes, long refreshTtlDays) {}

    public record Admin(String email, String password, String name) {}

    public record Defaults(long storageQuotaMb, long maxFileMb, int maxRoomMinutes, int maxActiveRooms, int maxParticipants) {}

    /** Servicio interno de conversión de documentos (vacío = edición de archivos de oficina desactivada). */
    public record Converter(String url, String token) {}

    /** IA con DeepSeek (API compatible con OpenAI). Desactivada por defecto; se activa a mano en .env con NORA_AI_ENABLED=true y la clave. */
    public record Ai(boolean enabled, String apiKey, String baseUrl, String model, int maxInputChars, int maxOutputTokens, int perHourLimit) {
        public boolean active() { return enabled && apiKey != null && !apiKey.isBlank(); }
    }

    public record Storage(String endpoint, String adminEndpoint, String adminToken, String bucket, String region) {}
}
