package com.nora.auth;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {
    Optional<RefreshToken> findByTokenHash(String tokenHash);

    @Modifying
    @Query("update RefreshToken t set t.revoked = true where t.userId = :userId")
    void revokeAllForUser(UUID userId);

    @Query("select t from RefreshToken t where t.userId = :userId and t.revoked = false and t.expiresAt > :now order by t.lastUsedAt desc")
    java.util.List<RefreshToken> active(UUID userId, Instant now);

    @Modifying
    @Query("update RefreshToken t set t.revoked = true where t.userId = :userId and t.tokenHash <> :keepHash")
    void revokeOthers(UUID userId, String keepHash);

    @Modifying
    @Query("delete from RefreshToken t where t.expiresAt < :now")
    void deleteExpired(Instant now);
}
