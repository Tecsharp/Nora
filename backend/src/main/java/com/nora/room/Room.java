package com.nora.room;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "rooms")
public class Room {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(nullable = false, unique = true)
    private String code;

    @Column(nullable = false)
    private String name;

    @Column(name = "owner_id", nullable = false)
    private UUID ownerId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    /** null = sin expiración. */
    @Column(name = "expires_at")
    private Instant expiresAt;

    protected Room() {}

    public Room(String code, String name, UUID ownerId, Instant expiresAt) {
        this.code = code;
        this.name = name;
        this.ownerId = ownerId;
        this.expiresAt = expiresAt;
    }

    public UUID getId() { return id; }
    public String getCode() { return code; }
    public String getName() { return name; }
    public UUID getOwnerId() { return ownerId; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getExpiresAt() { return expiresAt; }
    public boolean isExpired() { return expiresAt != null && expiresAt.isBefore(Instant.now()); }
}
