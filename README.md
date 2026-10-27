# Nora

Aplicación web para compartir documentos y archivos de forma colaborativa en **salas temporales**: cada sala tiene un código, un tiempo de expiración, participantes conectados y un conjunto de herramientas (archivos, notas, portapapeles… y más por venir).

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
- **Archivos**: Garage solo es accesible desde el backend por la red interna. Cada descarga pasa por la API, que comprueba que el usuario participa en la sala; siempre se sirven como adjunto (`nosniff`), sin enlaces directos. Al expirar o cerrarse una sala se borran todos sus archivos.
- **Contenedores**: sistema de ficheros de solo lectura, `cap_drop: ALL`, `no-new-privileges`, usuarios sin privilegios, red `internal` para datos.
- **CORS**: por defecto solo mismo origen (el gateway). Para otros orígenes: `NORA_ALLOWED_ORIGINS=https://app.ejemplo.com`.
- **HTTPS**: el stack escucha en HTTP (por defecto solo en `127.0.0.1`). En producción pon delante un proxy con TLS y define `NORA_COOKIE_SECURE=true` y `NORA_BIND=0.0.0.0`.

### Acceso desde otros equipos y Cloudflare Tunnel

Por defecto el gateway solo escucha en `127.0.0.1` (`NORA_BIND`), así que únicamente se ve desde la propia máquina. Según cómo quieras entrar:

- **Por IP:puerto desde la red**: en `.env` pon `NORA_BIND=0.0.0.0` y recrea con `docker compose up -d`. Entra por `http://IP:29817`.
- **Cloudflare Tunnel con `cloudflared` instalado en el host**: apunta el servicio a `http://localhost:29817` (el `127.0.0.1` por defecto basta).
- **Cloudflare Tunnel con `cloudflared` en un contenedor**: dentro de ese contenedor `localhost` no es el host. Usa `NORA_BIND=0.0.0.0` y apunta a `http://IP-DEL-HOST:29817`, o conecta el contenedor a la red `nora_edge` y apunta a `http://gateway:8080`.

El gateway respeta `X-Forwarded-Proto` y `X-Forwarded-Host`, por lo que el login funciona tras HTTPS, y la cookie de sesión se marca `Secure` automáticamente cuando se entra por HTTPS.

### Administración

El administrador inicial se crea con `NORA_ADMIN_EMAIL` / `NORA_ADMIN_PASSWORD`. En **Admin** puede, por usuario, activar/desactivar la cuenta, cambiar el rol y fijar o poner **infinito (∞)** en: espacio total, tamaño máximo de archivo, duración máxima de sala (y salas sin expiración), salas activas y participantes por sala. Los valores por defecto de usuarios nuevos se configuran en `.env`.

## Desarrollo

```bash
# Backend (necesita Postgres y Garage; lo más simple: `docker compose up -d db garage` publicando sus puertos temporalmente)
cd backend && mvn spring-boot:run

# Frontend con proxy a http://localhost:8080
cd frontend && npm install && npm run dev
```

## Estado

Herramientas operativas: **Archivos**, **Notas**, **Portapapeles**. Pizarra, Media Review, Asistencia, Votaciones y Acciones aparecen como «Próximamente». La presencia de participantes se calcula por latido (cada 10 s); WebSockets quedan como mejora futura.
