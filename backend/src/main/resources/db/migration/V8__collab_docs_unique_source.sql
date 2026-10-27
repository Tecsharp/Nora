-- Un archivo de la sala solo puede tener un documento colaborativo abierto: si dos personas lo abren a la vez,
-- la segunda inserción falla y se reutiliza el documento de la primera (ver CollabService.fromFile).
DELETE FROM collab_docs d USING collab_docs e
 WHERE d.source_file_id IS NOT NULL AND d.room_id = e.room_id AND d.source_file_id = e.source_file_id
   AND (e.created_at, e.id) < (d.created_at, d.id);
DROP INDEX idx_collab_docs_source;
CREATE UNIQUE INDEX uq_collab_docs_source ON collab_docs (room_id, source_file_id) WHERE source_file_id IS NOT NULL;
