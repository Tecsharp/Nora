package com.nora.user;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users")
public class User {

    @Id
    private UUID id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "display_name", nullable = false)
    private String displayName;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role = Role.USER;

    @Column(nullable = false)
    private boolean enabled = true;

    @Column(name = "failed_attempts", nullable = false)
    private int failedAttempts;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    /** Los límites en null significan "infinito". */
    @Column(name = "storage_quota_bytes")
    private Long storageQuotaBytes;

    @Column(name = "max_file_size_bytes")
    private Long maxFileSizeBytes;

    @Column(name = "max_room_minutes")
    private Integer maxRoomMinutes;

    @Column(name = "max_active_rooms")
    private Integer maxActiveRooms;

    @Column(name = "max_participants")
    private Integer maxParticipants;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected User() {}

    public User(String email, String displayName, String passwordHash, Role role) {
        this.id = UUID.randomUUID();
        this.email = email;
        this.displayName = displayName;
        this.passwordHash = passwordHash;
        this.role = role;
    }

    public UUID getId() { return id; }
    public String getEmail() { return email; }
    public String getDisplayName() { return displayName; }
    public String getPasswordHash() { return passwordHash; }
    public Role getRole() { return role; }
    public void setRole(Role role) { this.role = role; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public int getFailedAttempts() { return failedAttempts; }
    public void setFailedAttempts(int failedAttempts) { this.failedAttempts = failedAttempts; }
    public Instant getLockedUntil() { return lockedUntil; }
    public void setLockedUntil(Instant lockedUntil) { this.lockedUntil = lockedUntil; }
    public Long getStorageQuotaBytes() { return storageQuotaBytes; }
    public void setStorageQuotaBytes(Long v) { this.storageQuotaBytes = v; }
    public Long getMaxFileSizeBytes() { return maxFileSizeBytes; }
    public void setMaxFileSizeBytes(Long v) { this.maxFileSizeBytes = v; }
    public Integer getMaxRoomMinutes() { return maxRoomMinutes; }
    public void setMaxRoomMinutes(Integer v) { this.maxRoomMinutes = v; }
    public Integer getMaxActiveRooms() { return maxActiveRooms; }
    public void setMaxActiveRooms(Integer v) { this.maxActiveRooms = v; }
    public Integer getMaxParticipants() { return maxParticipants; }
    public void setMaxParticipants(Integer v) { this.maxParticipants = v; }
    public Instant getCreatedAt() { return createdAt; }
}
