-- Chat v2: conversaciones dentro de la sala (general, grupos y mensajes directos) con su propio estado de lectura por persona.
CREATE TABLE chat_conversations (
    id              UUID PRIMARY KEY,
    room_id         UUID         NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    kind            VARCHAR(8)   NOT NULL,             -- ROOM (general), GROUP, DM
    name            VARCHAR(80),
    description     VARCHAR(300) NOT NULL DEFAULT '',
    color           VARCHAR(7),
    created_by      UUID         REFERENCES users (id) ON DELETE SET NULL,
    dm_key          VARCHAR(80),                       -- «idMenor:idMayor»: una sola conversación directa por pareja
    post_policy     VARCHAR(8)   NOT NULL DEFAULT 'ALL',    -- ALL | ADMINS: quién puede escribir
    add_policy      VARCHAR(8)   NOT NULL DEFAULT 'ADMINS', -- ALL | ADMINS: quién puede añadir gente
    created_at      TIMESTAMPTZ  NOT NULL,
    updated_at      TIMESTAMPTZ  NOT NULL,
    last_message_at TIMESTAMPTZ  NOT NULL
);
CREATE UNIQUE INDEX uq_chat_conv_dm ON chat_conversations (room_id, dm_key) WHERE dm_key IS NOT NULL;
CREATE UNIQUE INDEX uq_chat_conv_room ON chat_conversations (room_id) WHERE kind = 'ROOM';
CREATE INDEX idx_chat_conv_room ON chat_conversations (room_id, last_message_at DESC);

CREATE TABLE chat_members (
    conversation_id UUID        NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role            VARCHAR(8)  NOT NULL DEFAULT 'MEMBER', -- ADMIN | MEMBER
    muted           BOOLEAN     NOT NULL DEFAULT FALSE,
    pinned          BOOLEAN     NOT NULL DEFAULT FALSE,
    last_read_at    TIMESTAMPTZ NOT NULL,
    joined_at       TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_chat_members_user ON chat_members (user_id);

CREATE TABLE chat_messages (
    id              UUID PRIMARY KEY,
    conversation_id UUID         NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
    author_id       UUID         REFERENCES users (id) ON DELETE SET NULL,
    author_name     VARCHAR(120) NOT NULL,
    kind            VARCHAR(8)   NOT NULL DEFAULT 'TEXT', -- TEXT | SYSTEM («Ana creó el grupo»)
    text            VARCHAR(4000) NOT NULL,
    reply_to        UUID,
    reactions       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    edited          BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL,
    updated_at      TIMESTAMPTZ  NOT NULL
);
CREATE INDEX idx_chat_messages_conv ON chat_messages (conversation_id, created_at DESC);

-- El chat de antes (herramienta «chat» de room_items) pasa a ser la conversación general de cada sala.
INSERT INTO chat_conversations (id, room_id, kind, created_at, updated_at, last_message_at)
SELECT gen_random_uuid(), room_id, 'ROOM', min(created_at), now(), max(created_at)
FROM room_items WHERE tool = 'chat' GROUP BY room_id;

INSERT INTO chat_messages (id, conversation_id, author_id, author_name, kind, text, reply_to, reactions, edited, created_at, updated_at)
SELECT i.id, c.id, i.author_id, i.author_name, 'TEXT', i.data ->> 'text', NULLIF(i.data ->> 'replyTo', '')::uuid,
       COALESCE(i.data -> 'reactions', '{}'::jsonb), COALESCE((i.data ->> 'edited')::boolean, FALSE), i.created_at, i.updated_at
FROM room_items i JOIN chat_conversations c ON c.room_id = i.room_id AND c.kind = 'ROOM'
WHERE i.tool = 'chat';

DELETE FROM room_items WHERE tool = 'chat';
