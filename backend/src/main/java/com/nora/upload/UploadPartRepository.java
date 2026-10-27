package com.nora.upload;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface UploadPartRepository extends JpaRepository<UploadPart, UploadPart.Key> {
    List<UploadPart> findByUploadIdOrderByPartNumber(UUID uploadId);

    @Query("select coalesce(sum(p.sizeBytes), 0) from UploadPart p where p.uploadId = :uploadId")
    long sumReceived(UUID uploadId);
}
