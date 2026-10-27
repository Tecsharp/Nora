package com.nora.file;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "room_files")
public class RoomFile {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(name = "uploader_id", nullable = false)
    private UUID uploaderId;

    @Column(name = "original_name", nullable = false)
    private String originalName;

    @Column(name = "content_type", nullable = false)
    private String contentType;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(name = "object_key", nullable = false, unique = true)
    private String objectKey;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected RoomFile() {}

    public RoomFile(UUID roomId, UUID uploaderId, String originalName, String contentType, long sizeBytes) {
        this.roomId = roomId;
        this.uploaderId = uploaderId;
        this.originalName = originalName;
        this.contentType = contentType;
        this.sizeBytes = sizeBytes;
        this.objectKey = "rooms/" + roomId + "/" + id;
    }

    public UUID getId() { return id; }
    public UUID getRoomId() { return roomId; }
    public UUID getUploaderId() { return uploaderId; }
    public String getOriginalName() { return originalName; }
    public String getContentType() { return contentType; }
    public long getSizeBytes() { return sizeBytes; }
    public String getObjectKey() { return objectKey; }
    public Instant getCreatedAt() { return createdAt; }
}
