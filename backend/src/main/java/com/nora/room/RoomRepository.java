package com.nora.room;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface RoomRepository extends JpaRepository<Room, UUID> {
    Optional<Room> findByCode(String code);

    @Query("select count(r) from Room r where r.ownerId = :ownerId and (r.expiresAt is null or r.expiresAt > :now)")
    long countActiveByOwner(UUID ownerId, Instant now);

    @Query("select r from Room r where r.expiresAt is not null and r.expiresAt < :now")
    List<Room> findExpired(Instant now);

    @Query("select r from Room r join RoomMember m on m.roomId = r.id where m.userId = :userId "
            + "and (r.expiresAt is null or r.expiresAt > :now) order by r.createdAt desc")
    List<Room> findActiveForMember(UUID userId, Instant now);
}
