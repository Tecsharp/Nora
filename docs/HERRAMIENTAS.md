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

## Votaciones

Votaciones de una o varias opciones, anónimas o no, con **cierre manual o automático** (1 h, 24 h, 3 días, 1 semana), resultados con barras y porcentajes **en vivo**, avatares de quienes votaron cada opción (si no es anónima),
opción ganadora al cerrar, filtros Abiertas/Cerradas y plantilla «Sí / No / Me abstengo». Cualquier participante (también los lectores) puede votar y cambiar su voto mientras esté abierta; crear es de quien escribe; cerrar/reabrir, editar y
borrar, de su autor o de quien modera. En las **anónimas el servidor nunca envía quién votó qué** (solo totales y el propio voto). Con la IA activa: sugerir opciones y resumir el resultado.

## Media Review

Revisión de **vídeo, audio e imagen** de los archivos de la sala. El reproductor salta con precisión (flechas ±5 s, Mayús ±1 s, espacio para pausar, `C` para comentar), la **línea de tiempo muestra una marca por comentario** y pulsar una marca o su hora lleva a ese
momento. En imágenes se **señala un punto** (pin numerado). Los comentarios se pueden resolver/reabrir, editar y borrar, se filtran (todos/pendientes/resueltos), se copian como lista de cambios y, con la IA activa, se resumen. Cada archivo muestra cuántos
comentarios tiene pendientes (o un visto si todo está resuelto). Lectores: ven y reproducen, no comentan.

**Reproducción:** el navegador no puede enviar el token de sesión desde `<video>`, así que `POST /api/rooms/{code}/files/{id}/stream` devuelve una dirección **firmada y de 6 horas** (`/api/media/{token}`) que el servidor atiende **por tramos (Range, 206)** para poder saltar sin bajar el archivo entero.
Solo se sirven tipos de audio, vídeo e imagen raster conocidos (nunca SVG ni nada ejecutable), con `nosniff`.

## Calendario

Vista de **mes** (6 semanas, lunes primero, eventos con su hora y color, «+N más») y de **agenda** (próximos días agrupados: Hoy, Mañana…). Un clic en un día vacío crea un evento; los eventos tienen hora de inicio/fin o «todo el día»,
lugar o enlace de reunión (clicable), descripción y color. Cada participante responde **Voy / Quizás / No voy** (también los lectores) y todos ven quién va, en vivo. **Exportar `.ics`** (todos o uno) para el calendario del móvil o del ordenador.
La herramienta muestra una insignia con los **eventos de hoy** y avisa con un mensaje **10 minutos antes** de los que empiezan (salvo los que se han rechazado). Con la IA activa: **Crear desde texto** («mañana a las 17:00 reunión en la sala 2») con revisión antes de guardar.
Las horas se guardan sin zona (hora local de quien las ve), pensado para equipos en la misma zona horaria.

## Enlaces

Marcadores compartidos de la sala: **pega una dirección y Enter** (se normaliza, se evita el duplicado) o «Con detalles…» para título, descripción y etiquetas. Tarjetas con inicial de color por dominio (no se consultan iconos de Internet), **fijar arriba**, filtro por etiqueta y búsqueda,
copiar y abrir en pestaña nueva (`noopener noreferrer`). El servidor solo admite `http(s)`. Cualquier escritor puede fijar; editar y quitar es de quien lo añadió o de quien modera.

## Foco (Pomodoro compartido)

Un **temporizador único para toda la sala** (Foco 25 · Descanso corto 5 · Descanso largo 15 cada 4 pomodoros; duraciones y «empezar el siguiente solo» configurables). Todas las personas que escriben pueden empezar, pausar, reiniciar o saltar; los lectores lo ven.
El estado vive **en memoria del servidor** (`LiveService`) y se difunde como `live.changed`; el servidor es la única fuente de la hora y cada navegador calcula lo que falta con su desfase de reloj, así que todos ven lo mismo aunque tengan el reloj mal puesto. Al terminar cada periodo el servidor avanza solo y cada navegador **avisa
con un mensaje y un sonido** (generado con WebAudio, sin archivos; se puede apagar) aunque la herramienta esté cerrada; el **título de la pestaña** y la insignia de la herramienta muestran el tiempo mientras corre.
Cada persona puede **unirse al grupo de foco** con una frase de en qué trabaja; si se desconecta de la sala deja de contar. Si el servidor se reinicia, el temporizador vuelve a empezar.
