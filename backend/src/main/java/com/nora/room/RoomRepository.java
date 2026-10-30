package com.nora.room;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface RoomRepository extends JpaRepository<Room, UUID> {
    Optional<Room> findByCode(String code);

    List<Room> findByOwnerId(UUID ownerId);

    @Query("select count(r) from Room r where r.ownerId = :ownerId and (r.expiresAt is null or r.expiresAt > :now)")
    long countActiveByOwner(UUID ownerId, Instant now);

    @Query("select r from Room r where r.expiresAt is not null and r.expiresAt < :now and r.keepWhenExpired = false")
    List<Room> findExpired(Instant now);

    /** Salas con «mantener» que acaban de expirar y aún no se han dejado inactivas. */
    @Query("select r from Room r where r.expiresAt is not null and r.expiresAt < :now and r.keepWhenExpired = true and r.inactiveSince is null")
    List<Room> findNewlyInactive(Instant now);

    /** Las que participa la persona: activas y las inactivas conservadas. */
    @Query("select r from Room r join RoomMember m on m.roomId = r.id where m.userId = :userId "
            + "and (r.expiresAt is null or r.expiresAt > :now or r.keepWhenExpired = true) order by r.createdAt desc")
    List<Room> findVisibleForMember(UUID userId, Instant now);

    @Query("select r from Room r join RoomMember m on m.roomId = r.id where m.userId = :userId "
            + "and (r.expiresAt is null or r.expiresAt > :now) order by r.createdAt desc")
    List<Room> findActiveForMember(UUID userId, Instant now);
}
