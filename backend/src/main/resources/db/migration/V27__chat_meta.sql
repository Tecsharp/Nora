-- Mensajes del chat con archivos adjuntos (archivos de la sala) y con una llamada: lo guardan en «meta».
ALTER TABLE chat_messages ADD COLUMN meta JSONB NOT NULL DEFAULT '{}'::jsonb;
