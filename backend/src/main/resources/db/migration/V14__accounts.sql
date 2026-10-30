-- Cuentas: foto de perfil, sesiones ("recordarme" un mes, lista de sesiones), enlaces para cambiar la contraseña,
-- cierre de sesión forzado y ajustes del sistema que decide el administrador.
ALTER TABLE users ADD COLUMN avatar_version  INT         NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at   TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN tokens_valid_after TIMESTAMPTZ;

CREATE TABLE user_avatars (
    user_id     UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    content     BYTEA       NOT NULL,
    content_type VARCHAR(40) NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL
);

ALTER TABLE refresh_tokens ADD COLUMN remember     BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE refresh_tokens ADD COLUMN user_agent   VARCHAR(255);
ALTER TABLE refresh_tokens ADD COLUMN started_at   TIMESTAMPTZ;
ALTER TABLE refresh_tokens ADD COLUMN last_used_at TIMESTAMPTZ;

CREATE TABLE password_resets (
    id          UUID PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_by  UUID        REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_password_resets_user ON password_resets (user_id);

CREATE TABLE app_settings (
    key    VARCHAR(60) PRIMARY KEY,
    value  TEXT        NOT NULL
);
