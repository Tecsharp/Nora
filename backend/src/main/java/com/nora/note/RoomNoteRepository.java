package com.nora.note;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoomNoteRepository extends JpaRepository<RoomNote, UUID> {
    List<RoomNote> findByRoomIdAndKindOrderByCreatedAtDesc(UUID roomId, RoomNote.Kind kind, Pageable page);
    long countByRoomIdAndKind(UUID roomId, RoomNote.Kind kind);

    @org.springframework.transaction.annotation.Transactional
    void deleteByRoomIdAndFolderIdIn(UUID roomId, java.util.Collection<UUID> folderIds);
}
