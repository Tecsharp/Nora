package com.nora.upload;

import jakarta.persistence.*;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "upload_parts")
@IdClass(UploadPart.Key.class)
public class UploadPart {

    public static class Key implements Serializable {
        private UUID uploadId;
        private int partNumber;

        public Key() {}

        public Key(UUID uploadId, int partNumber) {
            this.uploadId = uploadId;
            this.partNumber = partNumber;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Key k && partNumber == k.partNumber && Objects.equals(uploadId, k.uploadId);
        }

        @Override
        public int hashCode() { return Objects.hash(uploadId, partNumber); }
    }

    @Id
    @Column(name = "upload_id")
    private UUID uploadId;

    @Id
    @Column(name = "part_number")
    private int partNumber;

    @Column(nullable = false)
    private String etag;

    @Column(name = "size_bytes", nullable = false)
    private int sizeBytes;

    protected UploadPart() {}

    public UploadPart(UUID uploadId, int partNumber, String etag, int sizeBytes) {
        this.uploadId = uploadId;
        this.partNumber = partNumber;
        this.etag = etag;
        this.sizeBytes = sizeBytes;
    }

    public UUID getUploadId() { return uploadId; }
    public int getPartNumber() { return partNumber; }
    public String getEtag() { return etag; }
    public int getSizeBytes() { return sizeBytes; }
}
