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

## Acciones (tablero de tareas)

Tablero de cuatro columnas (Por hacer, En curso, En revisión, Hecho) con **arrastrar y soltar** entre columnas y para ordenar (el orden se guarda con un valor intermedio entre las vecinas),
alta rápida con Enter, tarjetas con prioridad, fecha límite (vencida/hoy/pronto), responsable, etiquetas y progreso de la lista de pasos, ficha de detalle, búsqueda y filtros («Mis tareas»,
prioridad) y barra de progreso de la sala. Todo el que escribe puede mover y completar cualquier tarea; borrar es de su autora o de quien modera; los lectores solo ven. En pantallas táctiles se mueve
con las flechas de la tarjeta o su menú «Mover a». Con la IA activa: **Crear desde texto** (extrae tareas con responsable y fecha de unas notas, para revisar antes de añadir) y **Sugerir con IA** una descripción y pasos.
