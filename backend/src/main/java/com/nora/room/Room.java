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

    @Column(name = "keep_when_expired", nullable = false)
    private boolean keepWhenExpired;

    @Column(name = "inactive_since")
    private Instant inactiveSince;

    @Column(name = "require_approval", nullable = false)
    private boolean requireApproval;

    @Enumerated(EnumType.STRING)
    @Column(name = "default_role", nullable = false)
    private RoomRole defaultRole = RoomRole.MEMBER;

    /** Límite de participantes de esta sala (null = el que permita la cuenta del propietario). */
    @Column(name = "max_participants")
    private Integer maxParticipants;

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
    public void setExpiresAt(Instant expiresAt) { this.expiresAt = expiresAt; }
    public boolean isRequireApproval() { return requireApproval; }
    public void setRequireApproval(boolean requireApproval) { this.requireApproval = requireApproval; }
    public RoomRole getDefaultRole() { return defaultRole; }
    public void setDefaultRole(RoomRole defaultRole) { this.defaultRole = defaultRole; }
    public Integer getMaxParticipants() { return maxParticipants; }
    public void setMaxParticipants(Integer maxParticipants) { this.maxParticipants = maxParticipants; }
    public boolean isKeepWhenExpired() { return keepWhenExpired; }
    public void setKeepWhenExpired(boolean keepWhenExpired) { this.keepWhenExpired = keepWhenExpired; }
    public Instant getInactiveSince() { return inactiveSince; }
    public void setInactiveSince(Instant inactiveSince) { this.inactiveSince = inactiveSince; }
    public boolean isExpired() { return expiresAt != null && expiresAt.isBefore(Instant.now()); }
}
