-- «excalidraw» (extensión de las pizarras) no cabe en 8 caracteres.
ALTER TABLE collab_docs ALTER COLUMN source_ext TYPE VARCHAR(16);
