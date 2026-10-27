-- Carpetas (archivos) y categorías (notas y portapapeles) de una sala.
CREATE TABLE room_folders (
    id          UUID PRIMARY KEY,
    room_id     UUID        NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    kind        VARCHAR(10) NOT NULL,
    parent_id   UUID        REFERENCES room_folders (id) ON DELETE CASCADE,
    name        VARCHAR(60) NOT NULL,
    created_by  UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_folders_room ON room_folders (room_id, kind);

ALTER TABLE room_files ADD COLUMN folder_id UUID REFERENCES room_folders (id) ON DELETE SET NULL;
ALTER TABLE room_notes ADD COLUMN folder_id UUID REFERENCES room_folders (id) ON DELETE SET NULL;
ALTER TABLE upload_sessions ADD COLUMN folder_id UUID;
CREATE INDEX idx_files_folder ON room_files (folder_id);
CREATE INDEX idx_notes_folder ON room_notes (folder_id);
