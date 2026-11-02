# Herramientas de la sala

Las herramientas nuevas (Tablero, Votaciones, Media Review, Calendario, Enlaces, Reproductor) comparten una base común para que cada una sea pequeña,
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

Tres tipos de conversación dentro de la sala: **General** (todas las personas), **grupos** (con sus ajustes) y **mensajes directos**. Todo va por el **WebSocket**: los mensajes, las ediciones, borrados y reacciones, el
«**está escribiendo…**», el sin leer y los cambios de los grupos llegan al instante y **solo a quien participa** en cada conversación (eventos de usuario `chat.*`, no de sala).

**Dock abajo a la derecha** (como Facebook o Google Workspace): el panel de contactos en la esquina (chats recientes con su último mensaje y contador, y las personas de la sala con su punto de conexión) y, a su izquierda,
las **conversaciones abiertas como ventanas** que se minimizan, se cierran o se abren a pantalla completa. Cuando llega un mensaje de otra persona a un chat que no está a la vista, su ventana asoma minimizada con el contador.
El estado del dock se recuerda por sala. En pantallas estrechas el dock se reduce al botón «Chat» y abre la vista completa.

**Vista completa** (tarjeta Chat, al estilo de Telegram Web): lista de chats con buscador y filtros (Todos, No leídos, Grupos, Directos), conversación y panel de ajustes. Mensajes con respuestas citadas, reacciones, @menciones con
autocompletado, enlaces clicables, **botón «+»** junto a la caja de escritura con **adjuntar archivos** (se suben a *Archivos* de la sala y el mensaje los lleva para descargarlos; hasta 10 por mensaje), **enviar una llamada** (crea una llamada al momento, sin pasar por el calendario, y manda su enlace como tarjeta con «Unirse») e **iniciar videollamada** (lo mismo, y entras en el acto); **selector de emojis** con buscador por nombre en español, categorías, recientes y **tono de piel** (se recuerda), tanto para escribir como para reaccionar (cinco emojis rápidos y un «+» que abre el buscador), editar/borrar los propios (y borrar quien modera o administra), «Mensajes nuevos» al abrir, carga de anteriores y resumen con IA. Los lectores leen y reaccionan pero no escriben.

**Cambiar el nombre de un chat:** en el panel de configuración de la conversación, el nombre se edita según el rol: en un **grupo** (también los de llamada), quien lo administra; en **General**, quien modera la sala; en un **mensaje directo**, cualquiera de las dos personas. En General y en los directos, dejarlo vacío restablece el nombre de siempre (`PUT /api/rooms/{code}/chat/conversations/{id}/name`).

**Configuración de un grupo:** nombre, descripción y color; quién puede escribir y quién puede agregar personas (todas o solo administración); miembros con rol de administración (nombrar, quitar, expulsar); agregar personas de la sala;
silenciar y fijar (por persona); salir y borrar el grupo. El grupo nunca se queda sin administración (si sale la última persona administradora, pasa a la más antigua). Los cambios quedan como mensajes de sistema.
Quien sale de la sala o es expulsado deja también sus grupos y directos.

**Historial grande:** todos los mensajes se guardan en la base de datos mientras exista la sala (sin límite ni retención) y se cargan por páginas de 50; al subir con la rueda se piden los anteriores solos y lo que lees no se mueve.
La lista es **virtual**: solo se pintan los mensajes que se ven (unas decenas), así que una conversación de miles de mensajes va igual de fluida. **Buscar** (lupa de la cabecera de una conversación, o el buscador de la lista de chats para todas las que ves) usa un índice de trigramas de PostgreSQL (`pg_trgm`, migración `V21`): encuentra texto parcial, sin distinguir mayúsculas, y los resultados llegan por páginas.
Presionar un resultado (o una notificación o una cita) lleva al mensaje pidiendo **una ventana alrededor de él** (`GET …/conversations/{id}/window?around=`), no todo lo anterior; bajando se piden los siguientes (`?after=`) y «Ir a los mensajes recientes» vuelve al final.
Las citas de respuestas llegan ya resueltas por el servidor, aunque el mensaje original no esté cargado. Para salas grandes, el reparto en vivo va por un índice de conexiones por persona, la lista de conversaciones se calcula con unas pocas consultas, y las menciones y avisos de grupo se escriben por lotes.

**Avisos:** los mensajes nuevos **no** llegan a la campana: ya tienes el contador y la ventana del dock. Solo avisa cuando un mensaje lleva **más de 2 horas sin leerse** (`NORA_CHAT_NOTIFY_AFTER_MINUTES`, 120 por defecto): un único aviso por conversación («Ana te escribió», «3 mensajes sin leer en el grupo…») con enlace al mensaje, que no se repite y desaparece al leerla. No avisa de conversaciones silenciadas ni de mensajes que ya viste. Ningún otro mensaje del chat (tampoco las menciones) genera notificación; los avisos antiguos se borran al actualizar (migración `V23`).

Datos: `chat_conversations`, `chat_members` (rol, silenciar, fijar, última lectura) y `chat_messages` (migración `V19`, que además convierte el chat antiguo de cada sala en su conversación General).
API: `/api/rooms/{code}/chat/…` (`conversations`, `dm`, `messages`, `members`, `read`…); «escribiendo» es el mensaje WebSocket `chat.typing {conv}`.

## Tablero (tareas)

Tablero de cuatro columnas (Por hacer, En curso, En revisión, Hecho) con **arrastrar y soltar** entre columnas y para ordenar (el orden se guarda con un valor intermedio entre las vecinas),
alta rápida con Enter, tarjetas con prioridad, fecha límite (vencida/hoy/pronto), responsable, etiquetas y progreso de la lista de pasos, ficha de detalle, búsqueda y filtros («Mis tareas»,
prioridad) y barra de progreso de la sala. Todo el que escribe puede mover y completar cualquier tarea; borrar es de su autora o de quien modera; los lectores solo ven. En pantallas táctiles se mueve
con las flechas de la tarjeta o su menú «Mover a». Con la IA activa: **Crear desde texto** (extrae tareas con responsable y fecha de unas notas, para revisar antes de agregar) y **Sugerir con IA** una descripción y pasos.

## Votaciones

Votaciones de una o varias opciones, anónimas o no, con **cierre manual o automático** (1 h, 24 h, 3 días, 1 semana), resultados con barras y porcentajes **en vivo**, avatares de quienes votaron cada opción (si no es anónima),
opción ganadora al cerrar, filtros Abiertas/Cerradas y plantilla «Sí / No / Me abstengo». Cualquier participante (también los lectores) puede votar y cambiar su voto mientras esté abierta; crear es de quien escribe; cerrar/reabrir, editar y
borrar, de su autor o de quien modera. En las **anónimas el servidor nunca envía quién votó qué** (solo totales y el propio voto). Con la IA activa: sugerir opciones y resumir el resultado.

## Media Review

Revisión de **video, audio e imagen** de los archivos de la sala. El reproductor salta con precisión (flechas ±5 s, Shift ±1 s, espacio para pausar, `C` para comentar), la **línea de tiempo muestra una marca por comentario** y presionar una marca o su hora lleva a ese
momento. En imágenes se **señala un punto** (pin numerado). Los comentarios se pueden resolver/reabrir, editar y borrar, se filtran (todos/pendientes/resueltos), se copian como lista de cambios y, con la IA activa, se resumen. Cada archivo muestra cuántos
comentarios tiene pendientes (o un visto si todo está resuelto). Lectores: ven y reproducen, no comentan.

**Reproducción:** el navegador no puede enviar el token de sesión desde `<video>`, así que `POST /api/rooms/{code}/files/{id}/stream` devuelve una dirección **firmada y de 6 horas** (`/api/media/{token}`) que el servidor atiende **por tramos (Range, 206)** para poder saltar sin bajar el archivo entero.
Solo se sirven tipos de audio, video e imagen raster conocidos (nunca SVG ni nada ejecutable), con `nosniff`.

## Calendario

Vistas de **semana** (por defecto) y **día** con la cuadrícula de **horas** (como Google Calendar: fila «Todo el día», línea roja de la hora actual, eventos que se pisan repartidos en columnas, **arrastrar sobre la cuadrícula para crear un evento con su hora**), de **mes** (6 semanas, lunes primero, «+N más») y de **agenda** (próximos días agrupados: Hoy, Mañana…). Los eventos de **todo el día** van en la fila superior y en color sólido; la vista elegida se recuerda. Un clic en un día vacío crea un evento; los eventos tienen hora de inicio/fin o «todo el día»,
lugar o enlace de reunión (clicable), descripción y color. Cada participante responde **Voy / Quizás / No voy** (también los lectores) y todos ven quién va, en vivo. **Exportar `.ics`** (todos o uno) para el calendario del celular o del computadora.
La herramienta muestra una insignia con los **eventos de hoy** y avisa con un mensaje **10 minutos antes** de los que empiezan (salvo los que se han rechazado). Con la IA activa: **Crear desde texto** («mañana a las 17:00 reunión en la sala 2») con revisión antes de guardar.
Las horas se guardan sin zona (hora local de quien las ve), pensado para equipos en la misma zona horaria.

**Crear una cita (tarjeta rápida).** Al arrastrar sobre la cuadrícula, presionar un día del mes o usar «Nueva cita» aparece una **tarjeta flotante** junto a ese hueco, como la de Google Calendar: título, fecha y horas (al mover el inicio, el final se mueve con él), **Agregar invitados** (buscas por nombre o invitas a toda la sala), **Agregar una llamada de Nora**, lugar, descripción, color y visibilidad. «Más opciones» abre el formulario completo con lo escrito; la tarjeta se puede arrastrar y se cierra con Esc.

**Reuniones, llamadas y disponibilidad.** Al crear una cita puedes:
- **Invitar a personas de la sala**: reciben una notificación con el enlace al evento (el resto de la sala la ve en el calendario, pero no recibe aviso).
- **Agregar llamada**: se crea una llamada con su código (se ve en la ficha de la cita con «Unirse a la llamada» y «Copiar enlace»). Eliges si las personas entran directamente o si las admites tú. Cuando faltan 10 minutos, las personas que tienen ese hueco (quien lo creó, las invitadas y quienes dijeron «Voy») reciben un aviso **con enlace directo a la llamada**, aunque no tengan Nora abierta. Si quitas la llamada o borras la cita, la llamada termina; las programadas no terminan solas por estar vacías antes de su hora y aparecen en *Llamadas → Programadas desde el calendario*.
- **Cita personal**: solo la ven quien la crea y sus invitadas; el resto de la sala solo verá que estás «Ocupado» en ese hueco (nunca el título ni los detalles). Solo su autor puede editarla.
- **Buscar horario**: al elegir invitadas, el formulario solo avisa en una línea si alguien tiene algo a esa hora y ofrece **«Buscar horario»**. Ese botón cambia el calendario a las **agendas de las personas invitadas lado a lado** en un día (como «Buscar una hora» de Google Calendar): cada columna es una persona con sus citas (las personales ajenas salen como «Ocupado»), en verde los tramos en que **todas están libres**, y un clic coloca la cita en esa hora. **«Siguiente horario libre»** salta al próximo hueco común, en el mismo día o en otro (días laborables de 8:00 a 19:00, con la duración que elijas); **«Usar»** devuelve la hora a la cita. La vista **Disponibilidad** del calendario muestra, por persona y día, sus huecos ocupados (los eventos personales ajenos salen como «Ocupado»), lista los **mejores momentos para todas** (días laborables de 8:00 a 19:00, con la duración que elijas) y al presionar un horario libre propone la reunión con las personas elegidas.

Quién está ocupado en un hueco: quien creó la cita y sus invitadas (o, si no hay invitadas, quienes dijeron «Voy»), menos quien dijo «No voy». API: `GET /api/rooms/{code}/availability?from=AAAA-MM-DD&to=AAAA-MM-DD` (solo huecos; el título solo se devuelve a quien puede ver ese evento).

## Enlaces

Marcadores compartidos de la sala: **pega una dirección y Enter** (se normaliza, se evita el duplicado) o «Con detalles…» para título, descripción y etiquetas. Tarjetas con inicial de color por dominio (no se consultan iconos de Internet), **fijar arriba**, filtro por etiqueta y búsqueda,
copiar y abrir en pestaña nueva (`noopener noreferrer`). El servidor solo admite `http(s)`. Cualquier escritor puede fijar; editar y quitar es de quien lo agregó o de quien modera.

## Foco (Pomodoro compartido)

Un **temporizador único para toda la sala** (Foco 25 · Descanso corto 5 · Descanso largo 15 cada 4 pomodoros; duraciones y «empezar el siguiente solo» configurables). Todas las personas que escriben pueden empezar, pausar, reiniciar o saltar; los lectores lo ven.
El estado vive **en memoria del servidor** (`LiveService`) y se difunde como `live.changed`; el servidor es la única fuente de la hora y cada navegador calcula lo que falta con su desfase de reloj, así que todos ven lo mismo aunque tengan el reloj mal puesto. Al terminar cada periodo el servidor avanza solo y cada navegador **avisa
con un mensaje y un sonido** (generado con WebAudio, sin archivos; se puede apagar) aunque la herramienta esté cerrada; el **título de la pestaña** y la insignia de la herramienta muestran el tiempo mientras corre.
Cada persona puede **unirse al grupo de foco** con una frase de en qué trabaja; si se desconecta de la sala deja de contar. Si el servidor se reinicia, el temporizador vuelve a empezar.

## Reproductor sincronizado

Escuchen música o vean un video **a la vez**: una **cola compartida** (YouTube, enlaces directos a audio/video y archivos de la sala) y un solo reproductor cuyo play, pausa, salto, velocidad y siguiente se aplican a todas las personas. Quien llega tarde se pone solo en el punto exacto.
Se puede cerrar la ventana y **sigue sonando** (el Reproductor permanece montado; la insignia de la herramienta muestra que suena).

**Cómo se sincroniza.** El servidor (`LiveService`, en memoria) guarda «qué suena, la posición a la hora X del servidor, si está sonando y la velocidad». Cada navegador calcula dónde debería ir ahora con su desfase de reloj y corrige la deriva cada 1,5 s (si se aleja más de 1,2 s salta);
los gestos de quien reproduce se envían al servidor y los ajenos se aplican con una ventana de silencio para no devolver el eco. Si el navegador bloquea el sonido hasta que se pulse algo, aparece «Toca para unirte a la reproducción».

**YouTube y los anuncios.** Se incrusta con `youtube-nocookie.com` y se controla por `postMessage` **sin cargar ningún script de YouTube** (la política de seguridad solo permite ese iframe: `frame-src https://www.youtube-nocookie.com`). Nora **no bloquea ni salta anuncios** de YouTube (hacerlo infringe sus condiciones y se rompe a menudo): con YouTube Premium no salen,
y en el resto de casos pueden aparecer. Lo que **nunca** tiene anuncios: los audios y videos de los archivos de la sala y los enlaces directos (`media-src 'self' https:`). Los títulos de YouTube se piden al servidor (oEmbed público, solo `youtube.com`).

## Notificaciones

La **campana** de la barra superior reúne lo relevante de todas tus salas, con insignia de «sin ver», pestañas Todas / Sin ver y el botón **Marcar todas como vistas**. Llegan **en vivo** por el WebSocket (`notification.new`) y se sincronizan entre pestañas y dispositivos (`notification.read`).
Qué avisa: te asignan una tarea, alguien crea una votación o agenda un evento, comentan un archivo tuyo en Media Review, suben archivos (varios seguidos se agrupan), quieren entrar a tu sala o alguien entra, la sala va a expirar (a quien la creó) y cuando queda inactiva o se reactiva. Nunca te avisa de lo que haces tú.

**Cada aviso lleva el lugar exacto** (`link`: `tool`, `item`, `file`, `conv`, `msg`). Al pulsarlo se abre `/room/{código}?tool=…&item=…` y la herramienta se coloca justo ahí: la tarea se abre, el evento se abre en su día, la votación y el enlace se resaltan, el comentario de Media Review se resalta con su archivo elegido y el archivo nuevo se selecciona en su carpeta.
Las notificaciones se guardan en la tabla `notifications` (V18), se purgan las leídas con más de 30 días y se borran con la sala.
Para agregar un aviso nuevo basta llamar a `NotificationService.notify(...)` con el `link` al lugar; la herramienta recibe el destino en su prop `focus` y usa `useFocusTarget` y `flash` (`tools/focus.ts`).

## Llamadas

Llamadas y videollamadas de la sala con un **código** (`abc-defg-hij`), sala de espera con admisión del anfitrión, vistas Mosaico/Destacado/Barra lateral, pantalla compartida, reacciones, mano levantada, subtítulos, modo complementario y un chat de la llamada que queda en Mensajes. Al iniciar una llamada llega un aviso a la sala y la herramienta muestra una insignia mientras haya una abierta. Funcionamiento, límites (malla de hasta 8 personas) y protocolo en [LLAMADAS.md](LLAMADAS.md).
