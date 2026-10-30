package com.nora.notify;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    List<Notification> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable page);

    long countByUserIdAndReadAtIsNull(UUID userId);

    Optional<Notification> findFirstByUserIdAndGroupKeyAndReadAtIsNull(UUID userId, String groupKey);

    Optional<Notification> findByIdAndUserId(UUID id, UUID userId);

    @Modifying
    @Query("update Notification n set n.readAt = :now where n.userId = :userId and n.readAt is null")
    int markAllRead(UUID userId, Instant now);

    @Modifying
    @Query("update Notification n set n.readAt = :now where n.userId = :userId and n.groupKey = :groupKey and n.readAt is null")
    int markGroupRead(UUID userId, String groupKey, Instant now);

    @Modifying
    @Query("delete from Notification n where n.roomCode = :code")
    int deleteByRoom(String code);

    @Modifying
    @Query("delete from Notification n where n.readAt is not null and n.readAt < :before")
    int purgeRead(Instant before);
}
