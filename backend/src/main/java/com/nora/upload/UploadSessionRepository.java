package com.nora.upload;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface UploadSessionRepository extends JpaRepository<UploadSession, UUID> {
    List<UploadSession> findByRoomIdAndUserIdOrderByCreatedAtDesc(UUID roomId, UUID userId);
    java.util.Optional<UploadSession> findFirstByRoomIdAndUserIdAndFingerprint(UUID roomId, UUID userId, String fingerprint);
    List<UploadSession> findByRoomId(UUID roomId);
    List<UploadSession> findByUpdatedAtBefore(Instant before);
    long countByUserId(UUID userId);

    @Query("select coalesce(sum(s.sizeBytes), 0) from UploadSession s where s.userId = :userId")
    long sumSizeByUser(UUID userId);
}
