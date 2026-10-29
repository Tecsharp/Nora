# Agente de Nora (Asistencia)

Programa pequeño de escritorio (Rust, un solo ejecutable) que permite que alguien de tu sala **controle tu equipo con el ratón y el teclado**,
solo cuando tú lo aceptas desde Nora. Un navegador no puede hacerlo por sí solo; por eso existe.

**Ver** la pantalla de otra persona no necesita el agente: va dentro de Nora (WebRTC). El agente solo aplica los clics y las teclas. La imagen la
comparte tu navegador, no el agente.

## Cómo se usa

1. En Nora: sala → **Asistencia** → «Generar código» (vale 10 minutos y se usa una vez).
2. Ejecuta `nora-agent` (doble clic o desde la terminal). Te pide la dirección de tu Nora y el código; también se puede
   `nora-agent --server https://tu-nora --code ABCD-EFGH`. Después se recuerda: al abrirlo se conecta solo.
3. En Nora verás **Agente: Conectado**. Cuando otra persona pida controlar tu equipo aparecerá un aviso rojo; solo si pulsas **Permitir control**
   se aplica algo, y **Detener control** (o cerrar el agente) lo corta al instante.

`nora-agent --reset` olvida la vinculación. «Cerrar todas las sesiones» en Ajustes también invalida los agentes.

## Seguridad

- Se vincula con un código de un solo uso; el token que recibe se guarda en tu carpeta de configuración con permisos solo para ti.
- El servidor solo le reenvía clics y teclas de quien tú has autorizado, mientras dure el permiso y la sesión de pantalla; el agente además
  ignora cualquier entrada si no hay un control activo, y suelta teclas y botones al terminar.
- Avisa con una notificación (Linux/macOS) y en la consola cuando empieza y termina un control.
- Para controlar, comparte la **pantalla completa** (Nora lo exige): las coordenadas se aplican a la pantalla principal.

## Compilar

Nora **no compila** el agente al construir con Docker. Tienes dos caminos:

**A. Releases de GitHub (lo más cómodo).** Al subir una etiqueta `agent-vX.Y.Z` el flujo `.github/workflows/agent.yml` compila los tres sistemas (y firma el de Windows
si configuraste SignPath, ver `docs/ASISTENCIA.md`) y los publica en *Releases*. Descarga los archivos y déjalos en `agent/dist/` con estos nombres
(el gateway los sirve en `/downloads/` y Nora los ofrece en Asistencia):
`nora-agent-windows.exe`, `nora-agent-macos`, `nora-agent-linux`.

**B. Compilar a mano** (requiere [Rust](https://rustup.rs)); el resultado ya queda en `agent/dist/` con el nombre correcto:

| Sistema | Comando |
| --- | --- |
| Windows (PowerShell) | `.\agent\build.ps1` |
| macOS | doble clic en `agent/build-macos.command`, o `./agent/build.sh` |
| Linux | `./agent/build.sh` (necesita `libxkbcommon-dev`) |
| Windows desde Linux/macOS | `./agent/build.sh windows` (necesita mingw-w64) |

## Plataformas

| Sistema | Notas |
| --- | --- |
| Windows | Funciona. No puede controlar ventanas que se ejecutan como administrador salvo que el agente también lo haga. |
| macOS | Concede **Accesibilidad** (Ajustes del Sistema → Privacidad y seguridad) al programa la primera vez. Para compartir la pantalla, el navegador necesita el permiso de **Grabación de pantalla**. |
| Linux | Sesión **X11**. En Wayland el sistema no permite controlar el equipo desde un programa. |
