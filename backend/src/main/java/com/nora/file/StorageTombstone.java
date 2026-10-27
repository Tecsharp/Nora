package com.nora.file;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "storage_tombstones")
public class StorageTombstone {

    @Id
    @Column(name = "object_key")
    private String objectKey;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false)
    private int attempts;

    @Column(name = "last_error")
    private String lastError;

    protected StorageTombstone() {}

    public StorageTombstone(String objectKey) {
        this.objectKey = objectKey;
    }

    public String getObjectKey() { return objectKey; }
    public Instant getCreatedAt() { return createdAt; }
    public int getAttempts() { return attempts; }
    public String getLastError() { return lastError; }

    public void failed(String error) {
        attempts++;
        lastError = error == null ? null : error.substring(0, Math.min(error.length(), 500));
    }
}
