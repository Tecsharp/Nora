package com.nora.upload;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "upload_sessions")
public class UploadSession {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "file_id", nullable = false)
    private UUID fileId;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String fingerprint;

    @Column(name = "content_type", nullable = false)
    private String contentType;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(name = "part_size", nullable = false)
    private int partSize;

    @Column(name = "s3_upload_id", nullable = false)
    private String s3UploadId;

    @Column(name = "object_key", nullable = false)
    private String objectKey;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected UploadSession() {}

    public UploadSession(UUID roomId, UUID userId, UUID fileId, String name, String fingerprint, String contentType, long sizeBytes,
                         int partSize, String s3UploadId, String objectKey) {
        this.roomId = roomId;
        this.userId = userId;
        this.fileId = fileId;
        this.name = name;
        this.fingerprint = fingerprint;
        this.contentType = contentType;
        this.sizeBytes = sizeBytes;
        this.partSize = partSize;
        this.s3UploadId = s3UploadId;
        this.objectKey = objectKey;
    }

    public UUID getId() { return id; }
    public UUID getRoomId() { return roomId; }
    public UUID getUserId() { return userId; }
    public UUID getFileId() { return fileId; }
    public String getName() { return name; }
    public String getFingerprint() { return fingerprint; }
    public String getContentType() { return contentType; }
    public long getSizeBytes() { return sizeBytes; }
    public int getPartSize() { return partSize; }
    public String getS3UploadId() { return s3UploadId; }
    public String getObjectKey() { return objectKey; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void touch() { this.updatedAt = Instant.now(); }

    public int partCount() { return (int) ((sizeBytes + partSize - 1) / partSize); }

    public int expectedPartSize(int number) {
        long start = (long) (number - 1) * partSize;
        return (int) Math.min(partSize, sizeBytes - start);
    }
}
