package com.nora.file;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface RoomFileRepository extends JpaRepository<RoomFile, UUID> {
    List<RoomFile> findByRoomIdOrderByCreatedAtDesc(UUID roomId);

    List<RoomFile> findByRoomIdAndFolderIdIn(UUID roomId, java.util.Collection<UUID> folderIds);

    @Query("select f.objectKey from RoomFile f where f.objectKey in :keys")
    java.util.Set<String> existingKeys(java.util.Collection<String> keys);

    @Query("select coalesce(sum(f.sizeBytes), 0) from RoomFile f where f.uploaderId = :userId")
    long sumSizeByUploader(UUID userId);
}
