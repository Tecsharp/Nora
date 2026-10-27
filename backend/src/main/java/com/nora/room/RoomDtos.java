package com.nora.room;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class RoomDtos {
    private RoomDtos() {}

    /** minutes: null = valor por defecto, 0 = sin expiración (solo si el usuario tiene tiempo infinito). */
    public record CreateRoomRequest(
            @NotBlank(message = "El nombre es obligatorio") @Size(max = 80, message = "Máximo 80 caracteres") String name,
            @Min(0) Integer minutes,
            /** Opciones de la sala; todas son opcionales. */
            Boolean requireApproval,
            RoomRole defaultRole,
            @Min(value = 2, message = "Mínimo 2 participantes") Integer maxParticipants) {}

    /** Cambios de las opciones de la sala (solo se tocan los campos presentes; maxParticipants 0 = sin límite propio). */
    public record SettingsRequest(
            Boolean requireApproval,
            RoomRole defaultRole,
            @Min(value = 0, message = "No válido") Integer maxParticipants) {}

    public record RoomSettings(boolean requireApproval, String defaultRole, Integer maxParticipants) {}

    public record JoinRequestDto(UUID userId, String displayName, Instant requestedAt) {}

    /** pending = true: la sala pide aprobación y el propietario aún no ha respondido. */
    public record JoinResult(RoomDto room, boolean pending, String roomName) {}

    public record DecisionRequest(@jakarta.validation.constraints.NotNull Boolean approve) {}

    /** deltaMinutes > 0 extiende y < 0 reduce; unlimited = true quita la expiración (solo con tiempo infinito). */
    public record ExpiryRequest(
            @jakarta.validation.constraints.Min(value = -10080, message = "Máximo 7 días por cambio")
            @jakarta.validation.constraints.Max(value = 10080, message = "Máximo 7 días por cambio") Integer deltaMinutes,
            Boolean unlimited) {}

    public record JoinRoomRequest(
            @NotBlank @Size(max = 12) @Pattern(regexp = "^[A-Za-z0-9-]+$", message = "Código no válido") String code) {}

    public record ParticipantDto(UUID userId, String displayName, boolean online, boolean owner, String role) {}

    public record RoleRequest(@jakarta.validation.constraints.NotNull(message = "Indica el rol") RoomRole role) {}

    public record RoomDto(UUID id, String code, String name, Instant createdAt, Instant expiresAt,
                          UUID ownerId, boolean isOwner, String role, RoomSettings settings,
                          List<ParticipantDto> participants) {}

    public record RoomSummary(String code, String name, Instant expiresAt, boolean isOwner) {}
}
