-- Notificaciones de la aplicación: lo relevante para cada persona, con el enlace exacto al lugar donde ocurrió.
CREATE TABLE notifications (
    id         UUID PRIMARY KEY,
    user_id    UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    room_code  VARCHAR(16),
    room_name  VARCHAR(80),
    kind       VARCHAR(24)  NOT NULL,
    title      VARCHAR(200) NOT NULL,
    body       VARCHAR(400) NOT NULL DEFAULT '',
    link       JSONB        NOT NULL DEFAULT '{}',
    group_key  VARCHAR(100),
    count      INT          NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ  NOT NULL,
    read_at    TIMESTAMPTZ
);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_room ON notifications (room_code);
