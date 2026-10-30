# Nora Agent (Asistencia)

Programa pequeño y **visual** de escritorio (Rust, un solo ejecutable para Windows, macOS y Linux) que permite que alguien de tu sala **controle tu equipo con el ratón y el teclado**,
solo cuando tú lo aceptas desde Nora. Un navegador no puede hacerlo por sí solo; por eso existe.

**Ver** la pantalla de otra persona no necesita el agente: va dentro de Nora (WebRTC). El agente solo aplica los clics y las teclas. La imagen la
comparte tu navegador, no el agente.

## Cómo se usa

1. En Nora: sala → **Asistencia** → «Generar código» (vale 10 minutos y se usa una vez).
2. Abre **Nora Agent**. La primera vez te pide la dirección de tu Nora y el código; después se recuerda y se conecta solo.
3. La ventana muestra **Conectado a Nora**. Cuando otra persona pida controlar tu equipo verás el aviso rojo en Nora y, si lo aceptas, la ventana del agente se pone al frente con
   **Control remoto activo** y un botón grande **Detener control** (también se corta desde Nora o cerrando el agente, al instante).
4. En la ventana también puedes activar **Iniciar con el sistema** (arranca minimizado al iniciar sesión) y **Desvincular este equipo**.

Cerrar la ventana detiene el agente; minimizarla lo deja funcionando. Sin ventana (servidores, SSH): `nora-agent --cli --server https://tu-nora --code ABCD-EFGH`;
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
`nora-agent-windows.exe`, `nora-agent-macos.zip`, `nora-agent-linux`.

**B. Compilar a mano** (requiere [Rust](https://rustup.rs)); el resultado ya queda en `agent/dist/` con el nombre correcto:

| Sistema | Comando | Resultado |
| --- | --- | --- |
| Windows (PowerShell) | `.\agent\build.ps1` | `nora-agent-windows.exe` |
| macOS | doble clic en `agent/build-macos.command`, o `./agent/build.sh` | `Nora Agent.app` **universal** (Apple Silicon + Intel) y `nora-agent-macos.zip` |
| Linux | `./agent/build.sh` (necesita un compilador de C: `sudo apt install build-essential pkg-config`; si pide alguna librería más, `libx11-dev libxcb1-dev`) | `nora-agent-linux` |
| Windows desde Linux/macOS | `./agent/build.sh windows` (necesita mingw-w64) | `nora-agent-windows.exe` |

En macOS hace falta tener instaladas las herramientas de línea de comandos de Apple (`xcode-select --install`). La app se firma «ad hoc» (sin cuenta de Apple), así que **la primera vez**
hay que abrirla con clic derecho → Abrir (o `xattr -dr com.apple.quarantine "Nora Agent.app"` si se descargó). Firmarla y notarizarla con una cuenta de desarrollador de Apple quita ese paso.

## Plataformas

| Sistema | Notas |
| --- | --- |
| Windows | Funciona. No puede controlar ventanas que se ejecutan como administrador salvo que el agente también lo haga. |
| macOS | Concede **Accesibilidad** (Ajustes del Sistema → Privacidad y seguridad) a *Nora Agent* la primera vez; la ventana lo avisa y tiene un botón para abrir esos ajustes. Para compartir la pantalla, el navegador necesita el permiso de **Grabación de pantalla**. |
| Linux | Sesión **X11**. En Wayland el sistema no permite controlar el equipo desde un programa. |
