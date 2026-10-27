package com.nora.folder;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoomFolderRepository extends JpaRepository<RoomFolder, UUID> {
    List<RoomFolder> findByRoomIdAndKindOrderByNameAsc(UUID roomId, RoomFolder.Kind kind);
    long countByRoomIdAndKind(UUID roomId, RoomFolder.Kind kind);
    boolean existsByIdAndRoomId(UUID id, UUID roomId);
}
