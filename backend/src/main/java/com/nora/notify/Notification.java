package com.nora.notify;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "notifications")
public class Notification {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "room_code")
    private String roomCode;

    @Column(name = "room_name")
    private String roomName;

    @Column(nullable = false)
    private String kind;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String body = "";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private Map<String, Object> link = Map.of();

    @Column(name = "group_key")
    private String groupKey;

    @Column(nullable = false)
    private int count = 1;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "read_at")
    private Instant readAt;

    protected Notification() {}

    public Notification(UUID userId, String roomCode, String roomName, String kind, String title, String body, Map<String, Object> link, String groupKey) {
        this.userId = userId;
        this.roomCode = roomCode;
        this.roomName = roomName;
        this.kind = kind;
        this.title = title;
        this.body = body;
        this.link = link;
        this.groupKey = groupKey;
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public String getRoomCode() { return roomCode; }
    public String getRoomName() { return roomName; }
    public String getKind() { return kind; }
    public String getTitle() { return title; }
    public String getBody() { return body; }
    public Map<String, Object> getLink() { return link; }
    public String getGroupKey() { return groupKey; }
    public int getCount() { return count; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getReadAt() { return readAt; }

    public void markRead() { this.readAt = Instant.now(); }

    /** Una más del mismo tipo sin leer: se agrupan en una sola entrada con el contador y lo último. */
    public void bump(String title, String body, Map<String, Object> link) {
        this.count++;
        this.title = title;
        this.body = body;
        this.link = link;
        this.createdAt = Instant.now();
    }
}
