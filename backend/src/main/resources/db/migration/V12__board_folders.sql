-- Carpetas de la herramienta Pizarra: cada pizarra puede estar en una carpeta (kind = BOARD de room_folders).
ALTER TABLE collab_docs ADD COLUMN folder_id UUID REFERENCES room_folders (id) ON DELETE SET NULL;
CREATE INDEX idx_collab_docs_folder ON collab_docs (folder_id);
