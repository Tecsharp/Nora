CREATE TABLE users (
    id                    UUID PRIMARY KEY,
    email                 VARCHAR(254) NOT NULL UNIQUE,
    display_name          VARCHAR(60)  NOT NULL,
    password_hash         VARCHAR(100) NOT NULL,
    role                  VARCHAR(10)  NOT NULL,
    enabled               BOOLEAN      NOT NULL DEFAULT TRUE,
    failed_attempts       INT          NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,
    -- NULL en un límite = infinito
    storage_quota_bytes   BIGINT,
    max_file_size_bytes   BIGINT,
    max_room_minutes      INT,
    max_active_rooms      INT,
    max_participants      INT,
    created_at            TIMESTAMPTZ  NOT NULL
);

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_refresh_user ON refresh_tokens (user_id);

CREATE TABLE rooms (
    id          UUID PRIMARY KEY,
    code        VARCHAR(12)  NOT NULL UNIQUE,
    name        VARCHAR(80)  NOT NULL,
    owner_id    UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ  NOT NULL,
    expires_at  TIMESTAMPTZ
);
CREATE INDEX idx_rooms_owner ON rooms (owner_id);
CREATE INDEX idx_rooms_expires ON rooms (expires_at);

CREATE TABLE room_members (
    room_id       UUID        NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    user_id       UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    joined_at     TIMESTAMPTZ NOT NULL,
    last_seen_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE room_files (
    id             UUID PRIMARY KEY,
    room_id        UUID         NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    uploader_id    UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    original_name  VARCHAR(255) NOT NULL,
    content_type   VARCHAR(127) NOT NULL,
    size_bytes     BIGINT       NOT NULL,
    object_key     VARCHAR(200) NOT NULL UNIQUE,
    created_at     TIMESTAMPTZ  NOT NULL
);
CREATE INDEX idx_files_room ON room_files (room_id);
CREATE INDEX idx_files_uploader ON room_files (uploader_id);

CREATE TABLE room_notes (
    id          UUID PRIMARY KEY,
    room_id     UUID        NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    author_id   UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind        VARCHAR(10) NOT NULL,
    content     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_notes_room ON room_notes (room_id, kind, created_at DESC);
