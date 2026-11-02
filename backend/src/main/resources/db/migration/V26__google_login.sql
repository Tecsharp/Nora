-- Inicio de sesión con Google: la cuenta se enlaza por el identificador estable de Google («sub»).
-- Las cuentas creadas desde Google no tienen contraseña propia (password_set = false) hasta que la elijan en Configuración.
ALTER TABLE users ADD COLUMN google_sub   VARCHAR(64);
ALTER TABLE users ADD COLUMN password_set BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX idx_users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;
