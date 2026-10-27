-- Opciones de la sala y solicitudes de entrada pendientes de aprobación.
ALTER TABLE rooms ADD COLUMN require_approval BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE rooms ADD COLUMN default_role     VARCHAR(12) NOT NULL DEFAULT 'MEMBER';
ALTER TABLE rooms ADD COLUMN max_participants INT;

CREATE TABLE room_join_requests (
    id          UUID PRIMARY KEY,
    room_id     UUID        NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL,
    UNIQUE (room_id, user_id)
);
