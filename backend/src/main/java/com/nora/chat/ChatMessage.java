package com.nora.chat;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "chat_messages")
public class ChatMessage {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "conversation_id", nullable = false)
    private UUID conversationId;

    @Column(name = "author_id")
    private UUID authorId;

    @Column(name = "author_name", nullable = false)
    private String authorName;

    @Column(nullable = false)
    private String kind = "TEXT";

    @Column(nullable = false)
    private String text;

    @Column(name = "reply_to")
    private UUID replyTo;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private Map<String, List<String>> reactions = new LinkedHashMap<>();

    @Column(nullable = false)
    private boolean edited;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected ChatMessage() {}

    public ChatMessage(UUID conversationId, UUID authorId, String authorName, String kind, String text, UUID replyTo) {
        this.conversationId = conversationId;
        this.authorId = authorId;
        this.authorName = authorName;
        this.kind = kind;
        this.text = text;
        this.replyTo = replyTo;
    }

    public UUID getId() { return id; }
    public UUID getConversationId() { return conversationId; }
    public UUID getAuthorId() { return authorId; }
    public String getAuthorName() { return authorName; }
    public String getKind() { return kind; }
    public String getText() { return text; }
    public void setText(String text) { this.text = text; this.edited = true; this.updatedAt = Instant.now(); }
    public UUID getReplyTo() { return replyTo; }
    public Map<String, List<String>> getReactions() { return reactions; }
    public void setReactions(Map<String, List<String>> r) { this.reactions = r; this.updatedAt = Instant.now(); }
    public boolean isEdited() { return edited; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
