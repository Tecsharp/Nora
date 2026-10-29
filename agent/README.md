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

```sh
./agent/build.sh          # deja el binario en agent/dist/ (Nora lo ofrece en /downloads/)
```

Para los tres sistemas a la vez usa el flujo de GitHub Actions `.github/workflows/agent.yml` y copia los artefactos a `agent/dist/` como
`nora-agent-windows.exe`, `nora-agent-macos` y `nora-agent-linux`.

## Plataformas

| Sistema | Notas |
| --- | --- |
| Windows | Funciona. No puede controlar ventanas que se ejecutan como administrador salvo que el agente también lo haga. |
| macOS | Concede **Accesibilidad** (Ajustes del Sistema → Privacidad y seguridad) al programa la primera vez. Para compartir la pantalla, el navegador necesita el permiso de **Grabación de pantalla**. |
| Linux | Sesión **X11**. En Wayland el sistema no permite controlar el equipo desde un programa. |
