package com.nora.call;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "calls")
public class Call {

    public static final String ACCESS_HOST = "HOST";
    public static final String ACCESS_OPEN = "OPEN";

    @Id
    private UUID id = UUID.randomUUID();

    @Column(nullable = false, length = 12, unique = true)
    private String code;

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(name = "host_id", nullable = false)
    private UUID hostId;

    @Column(name = "host_name", nullable = false, length = 120)
    private String hostName;

    @Column(nullable = false, length = 80)
    private String title = "";

    @Column(nullable = false, length = 8)
    private String access = ACCESS_HOST;

    @Column(name = "conversation_id")
    private UUID conversationId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "ended_at")
    private Instant endedAt;

    protected Call() {}

    public Call(String code, UUID roomId, UUID hostId, String hostName, String title, String access) {
        this.code = code;
        this.roomId = roomId;
        this.hostId = hostId;
        this.hostName = hostName;
        this.title = title;
        this.access = access;
    }

    public UUID getId() { return id; }
    public String getCode() { return code; }
    public UUID getRoomId() { return roomId; }
    public UUID getHostId() { return hostId; }
    public String getHostName() { return hostName; }
    public String getTitle() { return title; }
    public String getAccess() { return access; }
    public void setAccess(String access) { this.access = access; }
    public UUID getConversationId() { return conversationId; }
    public void setConversationId(UUID conversationId) { this.conversationId = conversationId; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getEndedAt() { return endedAt; }
    public void end() { this.endedAt = Instant.now(); }
    public boolean isEnded() { return endedAt != null; }
}
