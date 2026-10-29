# Nora

Aplicación web para compartir documentos y archivos de forma colaborativa en **salas temporales**: cada sala tiene un código, un tiempo de expiración, participantes conectados y un conjunto de herramientas (archivos, notas, pizarra… y más por venir).

Todo corre en Docker: clonas, ejecutas un comando y listo.

## Arranque rápido

Requisitos: Docker con Compose v2.

```bash
git clone https://github.com/tecsharp/nora.git && cd nora
./setup.sh          # Windows: ./setup.ps1
```

El script crea `.env` con secretos aleatorios (BD, JWT, Garage y contraseña del administrador, que muestra por pantalla) y ejecuta `docker compose up -d --build`. Después abre <http://localhost:29817> (el puerto se cambia con `NORA_PORT` en `.env`).

También puedes hacerlo a mano: `cp .env.example .env`, editar los secretos y `docker compose up -d --build`.

## Arquitectura

```
Navegador ──► gateway (nginx, único puerto publicado)
                ├── /      ► frontend  (React + Vite, servido por nginx)
                └── /api   ► backend   (Spring Boot 3, Java 21)
                               ├── db      (PostgreSQL 16)        ┐ red interna,
                               └── garage  (almacén S3, archivos) ┘ sin acceso a Internet
```

| Servicio | Tecnología | Notas |
|---|---|---|
| `gateway` | nginx | Rate limiting por IP (más estricto en `/api/auth`), cabeceras de seguridad/CSP, límites de tamaño, bloquea `/actuator`. |
| `frontend` | React + Vite + TypeScript | SPA estática. |
| `backend` | Spring Boot 3.4 / Java 21 | JWT, Flyway, validación, CORS configurable. Configura Garage él solo al arrancar. |
| `garage` | [Garage](https://garagehq.deuxfleurs.fr/) (S3) | Volúmenes `nora_garage_meta` y `nora_garage_data`. Sin puertos publicados, bucket privado. El backend asigna el layout, crea el bucket y su clave de acceso por la API de administración: no hay que hacer nada. |
| `db` | PostgreSQL 16 | Volumen `nora_pgdata`. Sin puerto publicado. |

### Seguridad

- **Autenticación propia** (registro + login): contraseñas con BCrypt (coste 12), política de contraseñas, bloqueo temporal tras 5 intentos fallidos, mensajes que no revelan si el email existe.
- **Sesiones**: access token JWT de 15 min (en memoria del navegador) + refresh token opaco en cookie `HttpOnly; SameSite=Strict`, guardado hasheado y **rotado en cada uso**; si se reutiliza uno ya rotado se cierran todas las sesiones del usuario.
- **Archivos**: Garage solo es accesible desde el backend por la red interna. Cada descarga pasa por la API, que comprueba que el usuario participa en la sala; siempre se sirven como adjunto (`nosniff`), sin enlaces directos. Al expirar o cerrarse una sala se borran todos sus archivos (ver «Limpieza del almacén»).
- **Contenedores**: sistema de ficheros de solo lectura, `cap_drop: ALL`, `no-new-privileges`, usuarios sin privilegios, red `internal` para datos.
- **CORS**: por defecto solo mismo origen (el gateway). Para otros orígenes: `NORA_ALLOWED_ORIGINS=https://app.ejemplo.com`.
- **HTTPS**: el stack escucha en HTTP (por defecto solo en `127.0.0.1`). En producción pon delante un proxy con TLS y define `NORA_COOKIE_SECURE=true` y `NORA_BIND=0.0.0.0`.

### Tiempo real (WebSocket)

Una única conexión `/ws` por pestaña, autenticada con un **ticket de un solo uso** (30 s) que se pide a `POST /api/ws/ticket`: el JWT nunca va en la URL. Se valida el origen igual que CORS, hay límite de conexiones y de mensajes, y las conexiones mudas se cierran a los 90 s (el cliente envía un ping cada 25 s y reconecta solo con espera exponencial).

Eventos de sala: quién está conectado (`presence`, `joined`), nuevos miembros (`member.joined`), archivos (`file.added`, `file.deleted`), notas y portapapeles (`note.added`, `note.deleted`), progreso de subidas ajenas (`upload.progress`, `upload.done`, `upload.aborted`), avisos de expiración a 5 y 1 minuto (`room.expiring`) y cierre de sala (`room.closed`). Eventos de cuenta: `account.updated` (el admin cambió tus límites) y `account.disabled`. Los eventos se emiten **después de confirmar la transacción** de base de datos, así que nadie recibe un aviso de algo que luego se revierte. Si se pierde la conexión, al reconectar la interfaz recarga lo que se perdió.

### Edición colaborativa (documentos, hojas y presentaciones)

Todo documento es un **archivo de la sala**. En **Archivos** el botón **Nuevo** crea un documento, una hoja o una presentación (nace como `.docx`, `.xlsx` o `.pptx` en la carpeta actual) y un clic sobre cualquier DOCX/ODT/XLSX/ODS/CSV/PPTX/ODP lo abre para editarlo entre todos, con cursores, selección de cada persona, historial de versiones y control de permisos (el lector ve pero no edita). **Guardar** (o Ctrl+S) escribe el contenido compartido en ese archivo y todos ven si está al día; **Descargar** y «guardar una copia» son botones aparte.

Cada editor tiene una cinta de opciones al estilo Office: **texto** (fuentes, tamaños, colores, listas, tablas, gráficos, buscar y reemplazar), **hojas** (formato, bordes, fórmulas con nombres en español, insertar/eliminar filas y columnas, ordenar, gráficos, estadísticas) y **diapositivas** (texto enriquecido, formas, tablas, gráficos, notas, modo presentación). Usa **Yjs (CRDT)** sobre el WebSocket de Nora; el servidor solo ordena, guarda y reparte los cambios. La conversión la hace el servicio interno `converter` (LibreOffice headless, sin acceso a Internet). Diseño, protocolo, fidelidad de conversión, fases y **limitaciones conocidas** en [docs/COLABORACION.md](docs/COLABORACION.md).

### Pizarra colaborativa

La herramienta **Pizarra** de cada sala es un lienzo infinito con el editor de **Excalidraw** (todas sus herramientas: formas, flechas ligadas, texto, dibujo libre, imágenes, marcos, láser, biblioteca…) sincronizado en tiempo real por el WebSocket de Nora, con cursores con nombre, selecciones, seguimiento de otra persona y permisos de la sala. Las figuras y textos se **alinean y centran** con el imán (guías al mover), con la barra «Alinear» y con las opciones de Excalidraw, y el editor tiene **pantalla completa**. Se guarda sola; **Guardar** escribe el archivo `.excalidraw` en Archivos; se puede **descargar** (`.excalidraw`, PNG y SVG con la escena incrustada, PDF), guardar copias en la sala e **importar** `.excalidraw`, PNG/SVG con escena e imágenes. Funciona sin Internet. Detalles en [docs/PIZARRA.md](docs/PIZARRA.md).

### Subidas reanudables

Los archivos se suben por trozos de 8 MiB con multipart de S3 (`POST /api/rooms/{code}/uploads`, `PUT …/parts/{n}`, `POST …/complete`). El servidor guarda qué trozos llegaron: si se corta internet, se cierra la pestaña o se reinicia el navegador, al volver a elegir el mismo archivo solo se envían los que faltan. El cliente sube 3 trozos en paralelo, reintenta con espera, se pausa sin conexión y detecta conexiones colgadas (20 s sin avance). Muestra porcentaje, velocidad y tiempo restante; el resto de la sala ve el avance en vivo. Las subidas abandonadas se limpian a las 24 h.

Las subidas corren en segundo plano: un panel flotante las muestra cuando cierras el explorador de archivos o cambias de pantalla (con el explorador abierto el progreso se ve dentro de él, así nunca hay dos indicadores a la vez), y al cerrar la pestaña el navegador avisa. La velocidad se mide en los últimos segundos y cae a `0 KB/s` si la red se queda parada. Para reanudar tras **recargar la página o reiniciar el navegador sin volver a elegir el archivo**, Nora guarda una referencia al archivo en IndexedDB (API File System Access). Solo funciona en Chrome/Edge y en un contexto seguro (HTTPS o `localhost`; no por `http://IP:puerto`), y el navegador puede pedir permiso una vez para releer el archivo. En el resto, la subida interrumpida aparece con un botón «Reanudar» que pide elegir el mismo archivo. Al ir en trozos pequeños, también funcionan detrás de Cloudflare, que limita cada petición a 100 MB en el plan gratuito.

### Interfaz

- **Tema claro, oscuro o del sistema** (selector en la barra superior; se recuerda en el navegador y se aplica antes de pintar para evitar parpadeos).
- Tipografía del sistema (`-apple-system`, SF Pro en dispositivos Apple; Segoe UI/Roboto en el resto). Las fuentes SF no se incluyen porque su licencia no permite redistribuirlas. Diseño adaptable: en móvil los diálogos son hojas inferiores y las tablas se simplifican.
- **Archivos** funciona como un explorador: carpetas anidadas, migas de pan, vista cuadrícula/lista, búsqueda, orden, renombrar, mover (menú «Mover a…» o arrastrando) y subir arrastrando archivos a la carpeta actual. Borrar una carpeta elimina todo su contenido, también del almacén S3. Se pueden subir **carpetas enteras** (botón «Subir carpeta» o arrastrándolas): se reproduce su estructura en la sala y se omiten los archivos vacíos. Las descargas solo se inician con el botón y muestran un anillo de progreso sobre el icono (cancelables; se abortan si se quedan 45 s sin datos).
- **Notas** y **Pizarra** admiten categorías/carpetas (crear, renombrar, borrar, filtrar y mover elementos entre ellas).
- Páginas públicas de **Términos de uso**, **Privacidad** y **Manejo de datos** (`/terms`, `/privacy`, `/data`); el registro exige aceptarlos. Son una plantilla general: quien opere la instancia debe revisarlos y adaptarlos.

- **Duración de la sala**: el propietario (o un admin) puede extenderla o reducirla desde la sala o desde la lista de salas (`PATCH /api/rooms/{code}/expiry`, `{deltaMinutes}` o `{unlimited:true}`). Debe quedar al menos 1 minuto y la duración total respeta el límite de la cuenta.

### Roles en la sala

El creador de la sala asigna a cada participante uno de estos roles desde la lista de participantes (menú «⋯»; `PATCH /api/rooms/{code}/members/{userId}` con `{role}`):

| Rol | Puede |
|---|---|
| **Propietario** (el creador) | Todo: asignar roles, **expulsar participantes**, cambiar la duración y cerrar la sala |
| **Moderador** | Subir, crear y además editar, mover y borrar el contenido de cualquiera |
| **Colaborador** (por defecto) | Subir, crear carpetas, notas y portapapeles, y gestionar lo suyo |
| **Lector** | Solo ver, descargar y copiar |

**Expulsar** (menú «⋯» de la persona → «Expulsar de la sala», `DELETE /api/rooms/{code}/members/{userId}`): solo el propietario o un administrador; la persona sale de la lista, pierde el acceso en vivo y a los documentos abiertos al instante y recibe un aviso. Lo que subió se queda; puede volver con el código (y con aprobación si la sala la pide).

Los permisos se comprueban en el servidor (un lector recibe 403 al intentar subir o modificar) y el cambio de rol llega en vivo a la persona afectada. Un administrador del sistema conserva control sobre cualquier sala en la que participe.

**Archivos grandes y carpetas:** si el navegador comprime lo elegido en un `.zip` (Safari lo hace con carpetas y paquetes como `.app`, `.pages` o `.key`) y tarda en entregarlo, Nora muestra «Comprimiendo lo que elegiste…» con un indicador y explica que se subirá como `.zip`; al soltar una carpeta muestra «Leyendo la carpeta…». La compresión la hace el navegador, no Nora, así que no hay porcentaje, solo el aviso de que está ocurriendo.

**Selección múltiple:** en Archivos (y en Pizarra) se seleccionan varios elementos con la casilla de cada uno, Ctrl/⌘+clic, Mayús+clic (rango) o **arrastrando un rectángulo con el ratón** sobre un hueco. La barra de selección ofrece Descargar, **Mover a…** (cualquier carpeta o la raíz) y Borrar (con confirmación); también se pueden **arrastrar todos los seleccionados a una carpeta** o a la ruta de arriba. Esc quita la selección. Mover y borrar solo afectan a lo propio (o a todo si moderas).

### Visor de documentos

Al hacer clic en un archivo (o con el botón del ojo) se abre un visor con navegación entre los documentos de la carpeta (flechas del teclado o en pantalla): **imágenes** (JPG, PNG, GIF, WebP, AVIF, SVG…), **PDF** (con zoom, dibujado con pdf.js en el navegador) y **texto/código** (se muestra como texto plano, nunca se ejecuta). Todo se lee por la API autenticada y se muestra con URLs `blob:` locales; la CSP del gateway solo añade `blob:` para imágenes y workers. Los **vídeos no se previsualizan, solo se descargan**: reproducirlos exigiría transcodificarlos en el servidor (ffmpeg), algo que Nora no incluye por ahora.

### Limpieza del almacén (Garage)

Los objetos de Garage siempre acaban borrándose:

1. Al borrar un archivo, una carpeta o una sala, el objeto se anota en una tabla de borrados pendientes (`storage_tombstones`) **en la misma transacción** que quita la fila de la base de datos, y se borra justo después de confirmarla. Si Garage no responde en ese momento, la petición no se bloquea y el borrado queda pendiente.
2. Una tarea reintenta los pendientes cada 2 minutos hasta que Garage los borre.
3. Cada 6 horas se concilia el bucket con la base de datos y se eliminan los **huérfanos** (objetos sin archivo asociado) con más de 60 minutos (`nora.storage.orphan-grace-minutes`), margen para no tocar subidas recién terminadas.
4. Las salas expiradas las destruye una tarea cada minuto (con todos sus objetos).

En **Admin → Almacenamiento (Garage)** se ve cuántos objetos y bytes hay en Garage frente a los archivos de la base de datos, los borrados pendientes, y hay un botón para lanzar la limpieza a mano (`GET /api/admin/storage`, `POST /api/admin/storage/sweep`). Para comprobarlo de punta a punta en tu instalación: `NORA_ADMIN_EMAIL=… NORA_ADMIN_PASSWORD=… node scripts/verify-garage-cleanup.mjs` (sube archivos, los borra de todas las formas, hace expirar una sala, apaga Garage unos segundos y crea un huérfano, comprobando cada vez el contenido real del bucket). Nota: Garage libera el espacio físico en disco en segundo plano, por lo que el uso de disco puede tardar en bajar aunque los objetos ya no existan.

### Acceso desde otros equipos y Cloudflare Tunnel

Por defecto el gateway escucha en todas las interfaces (`NORA_BIND=0.0.0.0`), así que Nora es accesible por `http://IP-DEL-SERVIDOR:29817` desde tu red. Si solo quieres usarlo desde la propia máquina, pon `NORA_BIND=127.0.0.1` en `.env` y ejecuta `docker compose up -d`.

Con Cloudflare Tunnel:

- **`cloudflared` instalado en el host**: apunta el servicio a `http://localhost:29817`.
- **`cloudflared` en un contenedor**: dentro de él `localhost` no es el host. Apunta a `http://IP-DEL-SERVIDOR:29817`, o conecta el contenedor a la red `nora_edge` y apunta a `http://gateway:8080`.

Si lo expones a Internet, hazlo detrás de HTTPS (el túnel ya lo aporta) y valora desactivar el registro público con `NORA_ALLOW_REGISTRATION=false`.

El gateway respeta `X-Forwarded-Proto` y `X-Forwarded-Host`, por lo que el login funciona tras HTTPS, y la cookie de sesión se marca `Secure` automáticamente cuando se entra por HTTPS.

### Administración

El administrador inicial se crea con `NORA_ADMIN_EMAIL` / `NORA_ADMIN_PASSWORD`. En **Admin** hay una tabla paginada con búsqueda por nombre o correo y filtro por rol (`GET /api/admin/users?page&size&q&role`); al abrir una fila puede, por usuario, activar/desactivar la cuenta, cambiar el rol y fijar o poner **infinito (∞)** en: espacio total, tamaño máximo de archivo, duración máxima de sala (y salas sin expiración), salas activas y participantes por sala. Los valores por defecto de usuarios nuevos se configuran en `.env`.

## Desarrollo

```bash
# Backend (necesita Postgres y Garage; lo más simple: `docker compose up -d db garage` publicando sus puertos temporalmente)
cd backend && mvn spring-boot:run

# Frontend con proxy a http://localhost:8080
cd frontend && npm install && npm run dev
```

## Estado

Herramientas operativas: **Archivos**, **Notas** y **Pizarra** (colaborativa, estilo Excalidraw); la edición colaborativa de documentos vive dentro de **Archivos**. Votaciones, Media Review, Asistencia y Acciones aparecen como «Próximamente». La presencia y los eventos de la sala van por WebSocket.
