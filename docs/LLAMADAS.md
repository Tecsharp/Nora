# Llamadas y videollamadas

La herramienta **Llamadas** de cada sala abre llamadas de voz y vídeo con el mismo esquema que Google Meet: un **código** (`abc-defg-hij`) que se comparte, un **anfitrión** que decide quién entra y una pantalla completa en `/call/<código>`.

## Qué incluye

| Función | Cómo funciona |
|---|---|
| **Código y enlace** | Cada llamada tiene un código de 10 letras. Se entra por el enlace `/call/abc-defg-hij`, escribiéndolo en la herramienta o desde la notificación «X inició una llamada». |
| **Acceso por el anfitrión** | Al crearla se elige *«Yo admito a cada persona»* (sala de espera: el anfitrión ve «X quiere unirse» y pulsa Admitir/Rechazar) o *«Entran directamente»*. Se puede cambiar durante la llamada. Solo entran **personas de la sala**; para cualquier otra la llamada «no existe». Quien se cae por la red vuelve a entrar solo durante 2 minutos. |
| **Vídeo y voz** | WebRTC directo entre navegadores. Vista previa antes de entrar con cámara, micrófono y altavoz a elegir; la cámara apagada libera el dispositivo. Atajos **Ctrl+D** (micrófono) y **Ctrl+E** (cámara). |
| **Vistas** | **Automático**, **Mosaico**, **Destacado** y **Barra lateral**. Se puede fijar a una persona o pantalla. Quien habla sube solo a la principal y se marca con un borde. Pantalla completa y «pantalla en pantalla». |
| **Presentar pantalla** | Cualquiera puede presentar; la presentación pasa a la vista principal con el resto de personas a un lado. |
| **Reacciones** | 👍 👏 ❤️ 🎉 😂 😮 😢 🤔 🔥 🙏 flotan sobre la pantalla de todas las personas con el nombre de quien reacciona. |
| **Mano levantada** | Se ve en la baldosa y en la lista de personas (ordenada por quién la levantó antes). El anfitrión puede bajarla. |
| **Subtítulos** | Cada navegador transcribe la voz de su persona con el reconocimiento de voz del propio navegador y la reparte por Nora; no hay servidor de transcripción ni coste. Ver «Subtítulos» abajo. |
| **Modo complementario** | Para entrar junto a una sala con otras personas (o desde un segundo dispositivo): **sin micrófono ni altavoz** para evitar el eco, pero con chat, pantalla, reacciones y mano levantada. Se activa al entrar o desde «Más opciones». |
| **Chat de la llamada** | Pestaña *Chat*: **Crear chat de la llamada** crea un **grupo en Mensajes** con quienes están dentro (y añade a quien entre después). Al terminar queda en la sala con la línea «Llamada terminada · 12 min». |
| **Control del anfitrión** | Silenciar a una persona o a todas, bajar manos, sacar a alguien, cambiar el acceso y **terminar para todos**. Las personas con rol de moderador de la sala también son anfitrionas. |
| **Avisos** | Al iniciar una llamada llega una notificación a la sala con enlace directo, y la herramienta muestra una insignia mientras haya una abierta. |

## Llamadas desde el calendario

Al crear un evento del Calendario se puede marcar **Añadir llamada** e **invitar** a personas de la sala. La llamada tiene su código desde el principio, se ve en la ficha del evento, y quienes tienen ese hueco reciben un aviso 10 minutos antes con el enlace directo. Mientras no llega su hora aparece en *Programadas desde el calendario* y no termina sola por estar vacía (hasta 30 minutos después de la hora de fin prevista). Ver [HERRAMIENTAS.md](HERRAMIENTAS.md#calendario).

## Subtítulos

Los subtítulos usan la API `SpeechRecognition` del navegador:

- Funcionan en **Chrome, Edge y Safari**. **Firefox** y **Brave** no la incluyen (Brave la desactiva): allí no pueden transcribir su voz, aunque **sí ven los subtítulos de quien pueda**.
- Chrome y Edge envían el audio de **esa persona** al servicio de reconocimiento de Google/Microsoft; Nora no lo recibe ni lo guarda. Por eso es voluntario: cada persona activa el botón **CC** para sí. Quien no lo activa no genera subtítulos.
- El idioma se elige en *Más opciones → Ajustes* (español de España por defecto según el navegador).
- Si quisieras subtítulos para todas las personas sin depender del navegador, haría falta un servicio de transcripción en servidor (por ejemplo Whisper), con coste de CPU/GPU; no se incluye.

## Límites y diseño

- **Malla (P2P):** cada persona abre una conexión con todas las demás y envía su vídeo N-1 veces. Es muy barato de operar (el servidor solo señaliza) pero **solo escala a pocas personas**: por eso `NORA_CALL_MAX_PARTICIPANTS` vale **8** por defecto. Para reuniones grandes habría que añadir un SFU (LiveKit, mediasoup, Janus…).
- **Redes estrictas:** usa el STUN público (`NORA_STUN_URLS`) y, si hace falta, el TURN opcional de [Asistencia](ASISTENCIA.md) (`docker compose --profile turn up -d`). Sin TURN, algunas redes corporativas o 4G no conectan.
- **Permisos del navegador:** la cámara y el micrófono solo funcionan en **HTTPS** o `localhost`. El gateway los permite con `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self)`.
- **Sin grabación:** no se graba nada ni el servidor ve audio ni vídeo.
- **Estado en memoria:** quién está en cada llamada vive en el servidor en memoria; si se reinicia el backend, las personas vuelven a entrar solas al reconectar. Las llamadas y el chat sí se guardan en la base de datos (tabla `calls`).
- Una llamada sin nadie dentro **termina sola a los 5 minutos** (`NORA_CALL_EMPTY_MINUTES`). Hay como máximo 5 abiertas por sala.

## Protocolo (WebSocket `/ws`)

Señalización y estado por los mensajes `call.*` (con presupuesto de mensajes propio, porque ICE va a ráfagas):

```
cliente → servidor                                     servidor → cliente
  call.join {code, companion, mic, cam}                  call.joined {code, me, state} | call.waiting | call.denied
  call.leave {code}                                      call.state {…}        (a todas las personas, en cada cambio)
  call.me {code, mic, cam, screen, hand, cc, companion}  call.signal {code, from, data}   (oferta, respuesta, ICE)
  call.signal {code, to, data}                           call.reaction {from, name, emoji}
  call.reaction {code, emoji}                            call.caption {from, name, text, final}
  call.caption {code, text, final}                       call.mute | call.removed | call.ended | call.error
  call.admit {code, conn, allow}      (anfitrión)
  call.host {code, action, conn?, access?}  (mute · muteAll · lowerHand · remove · access · end)
```

REST: `POST /api/rooms/{code}/calls`, `GET /api/rooms/{code}/calls`, `GET /api/calls/{code}`, `POST /api/calls/{code}/end`, `POST /api/calls/{code}/chat`.

Cada pestaña es un participante (su identificador es el de su conexión WebSocket), así que una persona puede estar con el portátil y, de complemento, con el móvil. La negociación WebRTC la inicia siempre **una sola parte** de cada pareja (la de identificador menor) y las pistas cambian con `replaceTrack`, de modo que nunca se cruzan dos ofertas.
