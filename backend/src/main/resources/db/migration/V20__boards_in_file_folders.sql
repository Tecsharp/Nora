-- Pizarras y Archivos comparten ahora el mismo árbol de carpetas: las carpetas de la herramienta Pizarra (kind = BOARD) pasan a ser carpetas de archivos
-- y cada pizarra queda en esa carpeta (su archivo .excalidraw), de modo que se ven igual en las dos herramientas.
UPDATE room_folders b
SET name = left(b.name, 45) || ' (pizarras)'
WHERE b.kind = 'BOARD'
  AND EXISTS (SELECT 1 FROM room_folders f
              WHERE f.kind = 'FILE' AND f.room_id = b.room_id AND f.parent_id IS NOT DISTINCT FROM b.parent_id AND lower(f.name) = lower(b.name));

UPDATE room_folders SET kind = 'FILE' WHERE kind = 'BOARD';

UPDATE room_files f
SET folder_id = d.folder_id
FROM collab_docs d
WHERE d.kind = 'BOARD' AND d.source_file_id = f.id AND d.folder_id IS NOT NULL;
