-- Búsqueda en el historial del chat: un índice de trigramas permite buscar texto parcial (ILIKE '%…%') sin recorrer toda la tabla.
-- Si la base de datos no deja crear la extensión (algunas bases gestionadas), la búsqueda sigue funcionando, solo que sin índice.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE INDEX IF NOT EXISTS idx_chat_messages_trgm ON chat_messages USING gin (text gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm no disponible: la búsqueda en el chat funcionará sin índice (%)', SQLERRM;
END $$;
