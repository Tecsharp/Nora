-- Distingue un token renovado (rotado) de uno cerrado a propósito: solo reutilizar el primero indica un posible robo.
ALTER TABLE refresh_tokens ADD COLUMN rotated BOOLEAN NOT NULL DEFAULT FALSE;
