-- Llamadas y videollamadas dentro de una sala (WebRTC en malla; el servidor solo hace de señalización y de puerta de entrada).
CREATE TABLE calls (
    id              UUID PRIMARY KEY,
    code            VARCHAR(12)  NOT NULL UNIQUE,                 -- abc-defg-hij: lo que se comparte para entrar
    room_id         UUID         NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    host_id         UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    host_name       VARCHAR(120) NOT NULL,
    title           VARCHAR(80)  NOT NULL DEFAULT '',
    access          VARCHAR(8)   NOT NULL DEFAULT 'HOST',         -- HOST: el anfitrión admite a cada persona; OPEN: entran directamente las personas de la sala
    conversation_id UUID         REFERENCES chat_conversations (id) ON DELETE SET NULL,   -- chat de la llamada (aparece en Mensajes)
    created_at      TIMESTAMPTZ  NOT NULL,
    ended_at        TIMESTAMPTZ
);
CREATE INDEX idx_calls_room ON calls (room_id, created_at DESC);
CREATE INDEX idx_calls_open ON calls (room_id) WHERE ended_at IS NULL;
