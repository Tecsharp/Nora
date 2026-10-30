package com.nora.item;

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
@Table(name = "room_items")
public class RoomItem {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(nullable = false, length = 16)
    private String tool;

    @Column(name = "author_id")
    private UUID authorId;

    @Column(name = "author_name", nullable = false, length = 120)
    private String authorName;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private Map<String, Object> data;

    @Column(nullable = false)
    private double sort;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected RoomItem() {}

    public RoomItem(UUID roomId, String tool, UUID authorId, String authorName, Map<String, Object> data, double sort) {
        this.roomId = roomId;
        this.tool = tool;
        this.authorId = authorId;
        this.authorName = authorName;
        this.data = data;
        this.sort = sort;
    }

    public UUID getId() { return id; }
    public UUID getRoomId() { return roomId; }
    public String getTool() { return tool; }
    public UUID getAuthorId() { return authorId; }
    public String getAuthorName() { return authorName; }
    public Map<String, Object> getData() { return data; }
    public double getSort() { return sort; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }

    public void setData(Map<String, Object> data) {
        this.data = data;
        this.updatedAt = Instant.now();
    }

    public void setSort(double sort) {
        this.sort = sort;
        this.updatedAt = Instant.now();
    }
}
