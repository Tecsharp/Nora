package com.nora.user;

import java.time.Instant;
import java.util.UUID;

public record UserDto(
        UUID id,
        String email,
        String displayName,
        Role role,
        boolean enabled,
        Instant createdAt,
        Limits limits) {

    /** null = infinito. */
    public record Limits(
            Long storageQuotaBytes,
            Long maxFileSizeBytes,
            Integer maxRoomMinutes,
            Integer maxActiveRooms,
            Integer maxParticipants) {}

    public static UserDto of(User u) {
        return new UserDto(u.getId(), u.getEmail(), u.getDisplayName(), u.getRole(), u.isEnabled(), u.getCreatedAt(),
                new Limits(u.getStorageQuotaBytes(), u.getMaxFileSizeBytes(), u.getMaxRoomMinutes(),
                        u.getMaxActiveRooms(), u.getMaxParticipants()));
    }
}
