-- Objetos de Garage que hay que borrar. Se anotan en la misma transacción que borra la fila del archivo, así que
-- aunque Garage no responda en ese momento (o el proceso caiga), la tarea de limpieza los reintenta hasta lograrlo.
CREATE TABLE storage_tombstones (
    object_key  VARCHAR(200) PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL,
    attempts    INT         NOT NULL DEFAULT 0,
    last_error  VARCHAR(500)
);
