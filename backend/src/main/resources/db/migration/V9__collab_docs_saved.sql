-- Estado del archivo de la sala respecto al documento colaborativo: hasta qué cambio (seq) está guardado, cuándo y quién.
ALTER TABLE collab_docs
    ADD COLUMN saved_seq BIGINT      NOT NULL DEFAULT 0,
    ADD COLUMN saved_at  TIMESTAMPTZ,
    ADD COLUMN saved_by  UUID;
