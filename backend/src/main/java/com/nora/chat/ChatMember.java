package com.nora.chat;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "chat_members")
@IdClass(ChatMember.Key.class)
public class ChatMember {

    public static class Key implements Serializable {
        private UUID conversationId;
        private UUID userId;

        public Key() {}

        public Key(UUID conversationId, UUID userId) {
            this.conversationId = conversationId;
            this.userId = userId;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Key k && Objects.equals(conversationId, k.conversationId) && Objects.equals(userId, k.userId);
        }

        @Override
        public int hashCode() { return Objects.hash(conversationId, userId); }
    }

    @Id
    @Column(name = "conversation_id")
    private UUID conversationId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false)
    private String role = "MEMBER";

    @Column(nullable = false)
    private boolean muted;

    @Column(nullable = false)
    private boolean pinned;

    @Column(name = "last_read_at", nullable = false)
    private Instant lastReadAt = Instant.now();

    @Column(name = "joined_at", nullable = false)
    private Instant joinedAt = Instant.now();

    protected ChatMember() {}

    public ChatMember(UUID conversationId, UUID userId, String role) {
        this.conversationId = conversationId;
        this.userId = userId;
        this.role = role;
    }

    public UUID getConversationId() { return conversationId; }
    public UUID getUserId() { return userId; }
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    public boolean isAdmin() { return "ADMIN".equals(role); }
    public boolean isMuted() { return muted; }
    public void setMuted(boolean muted) { this.muted = muted; }
    public boolean isPinned() { return pinned; }
    public void setPinned(boolean pinned) { this.pinned = pinned; }
    public Instant getLastReadAt() { return lastReadAt; }
    public void setLastReadAt(Instant t) { this.lastReadAt = t; }
    public Instant getJoinedAt() { return joinedAt; }
}
