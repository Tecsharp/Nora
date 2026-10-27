-- Rol de cada participante dentro de una sala (el propietario lo asigna). El propietario no necesita fila de rol.
ALTER TABLE room_members ADD COLUMN role VARCHAR(12) NOT NULL DEFAULT 'MEMBER';
