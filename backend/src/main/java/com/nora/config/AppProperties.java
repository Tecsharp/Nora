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
        Storage storage) {

    public record Jwt(String secret, long accessTtlMinutes, long refreshTtlDays) {}

    public record Admin(String email, String password, String name) {}

    public record Defaults(long storageQuotaMb, long maxFileMb, int maxRoomMinutes, int maxActiveRooms, int maxParticipants) {}

    public record Storage(String endpoint, String accessKey, String secretKey, String bucket) {}
}
