-- Edición colaborativa en tiempo real (documentos, hojas de cálculo y presentaciones) con Yjs.
-- El servidor trata los cambios como bytes opacos: los guarda en orden (seq), los reparte y de vez en cuando un
-- cliente los compacta en una instantánea (snapshot). Quien abre el documento recibe instantánea + cambios posteriores.
CREATE TABLE collab_docs (
    id               UUID PRIMARY KEY,
    room_id          UUID         NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    kind             VARCHAR(8)   NOT NULL,              -- DOC | SHEET | SLIDES
    name             VARCHAR(120) NOT NULL,
    created_by       UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ  NOT NULL,
    updated_at       TIMESTAMPTZ  NOT NULL,
    source_file_id   UUID,                               -- archivo de la sala del que se abrió (sin FK: puede borrarse)
    source_ext       VARCHAR(8),
    seq              BIGINT       NOT NULL DEFAULT 0,    -- último cambio aceptado
    snapshot         BYTEA,
    snapshot_seq     BIGINT       NOT NULL DEFAULT 0,    -- la instantánea incluye todos los cambios <= snapshot_seq
    -- Siembra: el contenido inicial (importado del archivo) lo escribe en el documento UN cliente, el que lo reclama.
    seed_state       VARCHAR(8)   NOT NULL DEFAULT 'PENDING',  -- PENDING | CLAIMED | DONE
    seed_claimed_by  UUID,
    seed_claimed_at  TIMESTAMPTZ,
    seed_content     TEXT
);
CREATE INDEX idx_collab_docs_room ON collab_docs (room_id);
CREATE INDEX idx_collab_docs_source ON collab_docs (room_id, source_file_id);

CREATE TABLE collab_updates (
    doc_id      UUID        NOT NULL REFERENCES collab_docs (id) ON DELETE CASCADE,
    seq         BIGINT      NOT NULL,
    data        BYTEA       NOT NULL,
    author_id   UUID,
    created_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (doc_id, seq)
);

CREATE TABLE collab_versions (
    id          UUID PRIMARY KEY,
    doc_id      UUID         NOT NULL REFERENCES collab_docs (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ  NOT NULL,
    created_by  UUID         REFERENCES users (id) ON DELETE SET NULL,
    label       VARCHAR(80),
    seq         BIGINT       NOT NULL,
    snapshot    BYTEA        NOT NULL
);
CREATE INDEX idx_collab_versions_doc ON collab_versions (doc_id, created_at DESC);
