package com.nora.room;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoomJoinRequestRepository extends JpaRepository<RoomJoinRequest, UUID> {
    List<RoomJoinRequest> findByRoomIdOrderByCreatedAtAsc(UUID roomId);
    Optional<RoomJoinRequest> findByRoomIdAndUserId(UUID roomId, UUID userId);
}
