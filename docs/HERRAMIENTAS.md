# Herramientas de la sala

Las herramientas nuevas (Chat, Acciones, Votaciones, Media Review, Calendario, Enlaces, Reproductor) comparten una base común para que cada una sea pequeña,
segura y en tiempo real.

## Base: `room_items`

- Tabla `room_items` (migración `V16`): `room_id`, `tool`, `author_id`/`author_name` (el nombre queda aunque se borre la cuenta), `data` JSONB, `sort`, fechas.
- API genérica: `GET/POST /api/rooms/{code}/items/{tool}`, `PATCH/DELETE …/{id}` y acciones sueltas `POST …/{id}/{acción}` (votar, reaccionar, responder a un evento…).
- **Validación en el servidor** (`ItemSchemas`): cada herramienta tiene sus campos y límites; lo que no está en el esquema se descarta y los campos que gestiona el servidor (votos,
  respuestas, reacciones) nunca se aceptan del cliente.
- **Permisos** (`ItemService`): ver, votar, reaccionar y responder: cualquier participante. Crear y editar: quien pueda escribir (no lectores). Editar o borrar lo de otras personas: solo quien
  modera; las **tareas** las puede mover y completar todo el que escribe. Las acciones que cambian una sola parte se hacen con cerrojo de fila para no pisarse.
- **En vivo:** cada cambio se reparte a la sala como `item.changed {tool, op, item}` (tras confirmar la transacción). En el navegador, `useItems(code, tool)` carga, aplica los eventos y expone
  `create / update / remove / act`.

## Chat

Mensajes con respuestas citadas, reacciones con emoji, @menciones, enlaces pulsables, editar/borrar los propios (y borrar quien modera), agrupado por persona y día, «N mensajes nuevos»
al leer más arriba, carga de mensajes anteriores, insignia de **sin leer** en la herramienta y resumen de la conversación con IA. Los lectores leen y reaccionan pero no escriben.
