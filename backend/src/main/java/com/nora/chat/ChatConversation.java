package com.nora.chat;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "chat_conversations")
public class ChatConversation {

    public static final String ROOM = "ROOM";
    public static final String GROUP = "GROUP";
    public static final String DM = "DM";

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(nullable = false)
    private String kind;

    private String name;

    @Column(nullable = false)
    private String description = "";

    private String color;

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "dm_key")
    private String dmKey;

    @Column(name = "post_policy", nullable = false)
    private String postPolicy = "ALL";

    @Column(name = "add_policy", nullable = false)
    private String addPolicy = "ADMINS";

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @Column(name = "last_message_at", nullable = false)
    private Instant lastMessageAt = Instant.now();

    protected ChatConversation() {}

    public ChatConversation(UUID roomId, String kind, String name, UUID createdBy) {
        this.roomId = roomId;
        this.kind = kind;
        this.name = name;
        this.createdBy = createdBy;
    }

    public UUID getId() { return id; }
    public UUID getRoomId() { return roomId; }
    public String getKind() { return kind; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; touch(); }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; touch(); }
    public String getColor() { return color; }
    public void setColor(String color) { this.color = color; touch(); }
    public UUID getCreatedBy() { return createdBy; }
    public String getDmKey() { return dmKey; }
    public void setDmKey(String dmKey) { this.dmKey = dmKey; }
    public String getPostPolicy() { return postPolicy; }
    public void setPostPolicy(String postPolicy) { this.postPolicy = postPolicy; touch(); }
    public String getAddPolicy() { return addPolicy; }
    public void setAddPolicy(String addPolicy) { this.addPolicy = addPolicy; touch(); }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Instant getLastMessageAt() { return lastMessageAt; }
    public void setLastMessageAt(Instant t) { this.lastMessageAt = t; }
    public boolean isGroup() { return GROUP.equals(kind); }
    public boolean isRoom() { return ROOM.equals(kind); }
    public boolean isDm() { return DM.equals(kind); }

    private void touch() { this.updatedAt = Instant.now(); }
}
