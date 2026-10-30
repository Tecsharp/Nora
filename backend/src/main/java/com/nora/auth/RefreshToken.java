package com.nora.auth;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "refresh_tokens")
public class RefreshToken {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "token_hash", nullable = false, unique = true)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(nullable = false)
    private boolean revoked;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    /** «Recordarme»: la sesión dura un mes en vez de acabar con el navegador. */
    @Column(nullable = false)
    private boolean remember;

    @Column(name = "user_agent")
    private String userAgent;

    /** Cuándo empezó la sesión (se conserva al renovar el token). */
    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "last_used_at")
    private Instant lastUsedAt;

    /** Se cambió por uno nuevo al renovar la sesión (si se vuelve a presentar, es una reutilización). */
    @Column(nullable = false)
    private boolean rotated;

    protected RefreshToken() {}

    public RefreshToken(UUID userId, String tokenHash, Instant expiresAt) {
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
    }

    public UUID getId() { return id; }
    public boolean isRotated() { return rotated; }
    public void setRotated(boolean rotated) { this.rotated = rotated; }
    public boolean isRemember() { return remember; }
    public void setRemember(boolean remember) { this.remember = remember; }
    public String getUserAgent() { return userAgent; }
    public void setUserAgent(String userAgent) { this.userAgent = userAgent == null ? null : userAgent.substring(0, Math.min(255, userAgent.length())); }
    public Instant getStartedAt() { return startedAt; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }
    public Instant getLastUsedAt() { return lastUsedAt; }
    public void setLastUsedAt(Instant lastUsedAt) { this.lastUsedAt = lastUsedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public String getTokenHash() { return tokenHash; }
    public UUID getUserId() { return userId; }
    public Instant getExpiresAt() { return expiresAt; }
    public boolean isRevoked() { return revoked; }
    public void setRevoked(boolean revoked) { this.revoked = revoked; }
}
