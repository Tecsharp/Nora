-- Llamadas programadas desde el calendario: no terminan solas por estar vacías antes de su hora y se enlazan con su evento.
ALTER TABLE calls ADD COLUMN scheduled_at  TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN scheduled_end TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN event_id      UUID;
CREATE INDEX idx_calls_event ON calls (event_id) WHERE event_id IS NOT NULL;
