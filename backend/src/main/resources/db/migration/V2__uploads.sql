-- Subidas reanudables: una sesión por archivo y un registro por trozo recibido (multipart de S3).
CREATE TABLE upload_sessions (
    id            UUID PRIMARY KEY,
    room_id       UUID         NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    user_id       UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    file_id       UUID         NOT NULL,
    name          VARCHAR(255) NOT NULL,
    fingerprint   VARCHAR(160) NOT NULL,
    content_type  VARCHAR(127) NOT NULL,
    size_bytes    BIGINT       NOT NULL,
    part_size     INT          NOT NULL,
    s3_upload_id  VARCHAR(512) NOT NULL,
    object_key    VARCHAR(200) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL,
    updated_at    TIMESTAMPTZ  NOT NULL
);
CREATE INDEX idx_upload_sessions_user ON upload_sessions (user_id);
CREATE INDEX idx_upload_sessions_room ON upload_sessions (room_id);
CREATE INDEX idx_upload_sessions_updated ON upload_sessions (updated_at);

CREATE TABLE upload_parts (
    upload_id    UUID         NOT NULL REFERENCES upload_sessions (id) ON DELETE CASCADE,
    part_number  INT          NOT NULL,
    etag         VARCHAR(200) NOT NULL,
    size_bytes   INT          NOT NULL,
    PRIMARY KEY (upload_id, part_number)
);
