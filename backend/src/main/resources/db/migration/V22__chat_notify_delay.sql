-- Los mensajes del chat ya no avisan al instante: solo si siguen sin leerse pasado un tiempo (por defecto 2 horas).
-- notified_until recuerda hasta qué mensaje ya se avisó, para no repetir el aviso.
ALTER TABLE chat_members ADD COLUMN notified_until TIMESTAMPTZ;
