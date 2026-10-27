package com.nora.folder;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "room_folders")
public class RoomFolder {

    public enum Kind { FILE, NOTE, CLIPBOARD }

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Kind kind;

    @Column(name = "parent_id")
    private UUID parentId;

    @Column(nullable = false)
    private String name;

    @Column(name = "created_by", nullable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected RoomFolder() {}

    public RoomFolder(UUID roomId, Kind kind, UUID parentId, String name, UUID createdBy) {
        this.roomId = roomId;
        this.kind = kind;
        this.parentId = parentId;
        this.name = name;
        this.createdBy = createdBy;
    }

    public UUID getId() { return id; }
    public UUID getRoomId() { return roomId; }
    public Kind getKind() { return kind; }
    public UUID getParentId() { return parentId; }
    public String getName() { return name; }
    public UUID getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public void setName(String name) { this.name = name; }
    public void setParentId(UUID parentId) { this.parentId = parentId; }
}
