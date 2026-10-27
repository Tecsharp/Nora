package com.nora.room;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

/** Persona que ha usado el código de una sala con aprobación y espera la respuesta del propietario. */
@Entity
@Table(name = "room_join_requests")
public class RoomJoinRequest {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected RoomJoinRequest() {}

    public RoomJoinRequest(UUID roomId, UUID userId) {
        this.roomId = roomId;
        this.userId = userId;
    }

    public UUID getRoomId() { return roomId; }
    public UUID getUserId() { return userId; }
    public Instant getCreatedAt() { return createdAt; }
}
