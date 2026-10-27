package com.nora.room;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoomMemberRepository extends JpaRepository<RoomMember, RoomMember.Key> {
    List<RoomMember> findByRoomId(UUID roomId);
    long countByRoomId(UUID roomId);
}
