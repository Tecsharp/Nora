package com.nora.note;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "room_notes")
public class RoomNote {

    public enum Kind { NOTE, CLIPBOARD }

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(name = "author_id", nullable = false)
    private UUID authorId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Kind kind;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "folder_id")
    private UUID folderId;

    protected RoomNote() {}

    public RoomNote(UUID roomId, UUID authorId, Kind kind, String content) {
        this.roomId = roomId;
        this.authorId = authorId;
        this.kind = kind;
        this.content = content;
    }

    public UUID getId() { return id; }
    public UUID getRoomId() { return roomId; }
    public UUID getAuthorId() { return authorId; }
    public Kind getKind() { return kind; }
    public String getContent() { return content; }
    public Instant getCreatedAt() { return createdAt; }
    public UUID getFolderId() { return folderId; }
    public void setFolderId(UUID folderId) { this.folderId = folderId; }
    public void setContent(String content) { this.content = content; }
}
