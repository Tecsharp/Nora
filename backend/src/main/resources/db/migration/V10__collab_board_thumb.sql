-- Miniatura de las pizarras (JPEG/WebP pequeño que sube el editor al cerrar) para mostrarla en la galería.
ALTER TABLE collab_docs
    ADD COLUMN thumb    BYTEA,
    ADD COLUMN thumb_at TIMESTAMPTZ;
