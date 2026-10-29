# Asistencia: ver y controlar la pantalla de otra persona

## Piezas

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| Interfaz | `frontend/src/assist/` | `AssistProvider` (lógica WebRTC y estado), `AssistOverlay` (peticiones, pantalla que veo, avisos), `AssistTool` (la herramienta de la sala). |
| Señalización | `AssistService` + `NoraWebSocketHandler` | Mensajes `assist.*` por el WebSocket de la sala. Comprueba sala, membresía, quién es quién y el permiso de control. |
| Agente | `agent/` | Programa de escritorio (Rust + enigo) que aplica ratón y teclado. Canal propio `/ws/agent`. |
| Red | `NORA_STUN_URLS`, `NORA_TURN_*`, servicio `coturn` | Servidores para que los navegadores se encuentren. |

## Flujo de ver la pantalla

1. Quien ayuda pulsa «Ver su pantalla» → `assist.request {to, mode}`. (O quien necesita ayuda pulsa «Compartir la mía» → `assist.invite {to}` tras elegir qué pantalla enseñar.)
2. La otra persona ve un aviso y acepta (**el clic de aceptar abre el selector de pantalla del navegador**, que exige un gesto del usuario) → `assist.respond {accept}`.
3. El servidor ata la sesión a las dos pestañas concretas y manda `assist.started` a ambas. Quien comparte crea la oferta WebRTC y la señalización
   (`assist.signal {sdp | candidate}`) se reenvía solo entre esas dos pestañas.
4. Cualquiera termina con `assist.end`; también termina si se cierra una pestaña, se sale o expulsan de la sala, o se deja de compartir desde la barra del navegador.

## Flujo de controlar

1. El navegador no puede controlar nada: hace falta el **agente** en el equipo de quien comparte (`POST /api/assist/agent/code` → código de 8 caracteres, 10 min, un uso;
   el agente lo canjea en `POST /api/assist/agent/pair` por un token firmado de 90 días que caduca con «Cerrar todas las sesiones»).
2. El agente se conecta a `/ws/agent` (cabecera `Authorization: Bearer …`). Nora muestra «Conectado».
3. Quien ayuda pide control (`assist.control {action: request}`); el servidor lo rechaza si quien comparte no tiene el agente conectado. Quien comparte ve el aviso rojo
   y **Permitir control** (solo si compartió la pantalla completa) → `grant`.
4. Mientras `control` esté activo, `assist.input` de **la pestaña que ve** se reenvía al agente de **quien comparte** como `{type: "input", t, x, y, b, dx, dy, k}`:
   `mm` mover, `md`/`mu` botón, `wh` rueda, `kd`/`ku` tecla. Posiciones normalizadas 0–1 sobre la imagen de la pantalla; el agente las aplica a la pantalla principal.
5. `revoke` (cualquiera de los dos), terminar la sesión o caer el agente → `control.stop`: el agente suelta botones y teclas y deja de obedecer.

## Límites y decisiones

- Cada persona puede tener como máximo 6 sesiones abiertas; las peticiones sin respuesta caducan a los 2 minutos.
- Presupuesto de mensajes `assist.*`: 3000 por 10 s y conexión (el movimiento del ratón se limita a ~60/s en el navegador).
- Solo se reenvían entradas con tipos y campos validados (no se transporta nada arbitrario al agente).
- Móviles: los navegadores móviles no pueden compartir pantalla; sí pueden ver la de otros.
- Controlar exige compartir la **pantalla completa**; con varios monitores las coordenadas se aplican al monitor principal.
- Linux: solo X11. macOS: permisos de Accesibilidad (agente) y Grabación de pantalla (navegador). Windows: no alcanza ventanas elevadas.
- CSP: no necesita cambios (WebRTC no pasa por `connect-src`).
