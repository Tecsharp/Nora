-- Bibliotecas de Excalidraw: las del sistema (las sube un administrador y salen en todas las pizarras) y la propia de cada
-- persona en cada sala (dura lo que dure la sala; máximo 100 MB).
CREATE TABLE system_libraries (
    id          UUID PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    item_count  INT          NOT NULL,
    size_bytes  BIGINT       NOT NULL,
    data        TEXT         NOT NULL,
    created_by  UUID         REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL
);

CREATE TABLE board_libraries (
    room_id     UUID        NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    data        TEXT        NOT NULL,
    size_bytes  BIGINT      NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (room_id, user_id)
);
