-- Elementos de las herramientas de la sala que comparten forma (Chat, Acciones, Votaciones, Media Review, Calendario, Enlaces, Reproductor).
-- Cada herramienta guarda su contenido en `data` (JSON validado en el servidor); quien lo creó queda por nombre aunque su cuenta se borre.
CREATE TABLE room_items (
    id          UUID PRIMARY KEY,
    room_id     UUID        NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    tool        VARCHAR(16) NOT NULL,
    author_id   UUID        REFERENCES users (id) ON DELETE SET NULL,
    author_name VARCHAR(120) NOT NULL,
    data        JSONB       NOT NULL,
    sort        DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_room_items_room_tool ON room_items (room_id, tool, created_at);
