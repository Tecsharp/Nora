-- «Mantener sala»: al expirar, la sala no se borra; queda inactiva (sin sesiones en vivo) y su propietario puede reactivarla.
ALTER TABLE rooms ADD COLUMN keep_when_expired BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rooms ADD COLUMN inactive_since TIMESTAMPTZ;
