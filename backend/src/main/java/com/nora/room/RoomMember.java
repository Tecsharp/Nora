package com.nora.room;

import jakarta.persistence.*;
import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "room_members")
@IdClass(RoomMember.Key.class)
public class RoomMember {

    public static class Key implements Serializable {
        private UUID roomId;
        private UUID userId;

        public Key() {}

        public Key(UUID roomId, UUID userId) {
            this.roomId = roomId;
            this.userId = userId;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Key k && java.util.Objects.equals(roomId, k.roomId) && java.util.Objects.equals(userId, k.userId);
        }

        @Override
        public int hashCode() { return java.util.Objects.hash(roomId, userId); }
    }

    @Id
    @Column(name = "room_id")
    private UUID roomId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "joined_at", nullable = false)
    private Instant joinedAt = Instant.now();

    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt = Instant.now();

    protected RoomMember() {}

    public RoomMember(UUID roomId, UUID userId) {
        this.roomId = roomId;
        this.userId = userId;
    }

    public UUID getRoomId() { return roomId; }
    public UUID getUserId() { return userId; }
    public Instant getJoinedAt() { return joinedAt; }
    public Instant getLastSeenAt() { return lastSeenAt; }
    public void touch() { this.lastSeenAt = Instant.now(); }
}
