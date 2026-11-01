-- Los mensajes del chat ya no generan notificaciones al instante (solo el aviso de «sin leer tras N horas»).
-- Se eliminan las que se guardaron con el comportamiento anterior: título con el nombre de quien escribía o «te mencionó…».
DELETE FROM notifications
WHERE kind = 'chat'
  AND NOT (title LIKE '% te escribió'
        OR title LIKE 'Mensaje sin leer en %'
        OR title ~ '^[0-9]+ mensajes sin leer ');
