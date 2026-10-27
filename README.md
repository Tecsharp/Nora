# Nora

Aplicación web para compartir documentos y archivos de forma colaborativa en **salas temporales**: cada sala tiene un código, un tiempo de expiración, participantes conectados y un conjunto de herramientas (archivos, notas, portapapeles… y más por venir).

Todo corre en Docker: clonas, ejecutas un comando y listo.

## Arranque rápido

Requisitos: Docker con Compose v2.

```bash
git clone https://github.com/tecsharp/nora.git && cd nora
./setup.sh          # Windows: ./setup.ps1
```

El script crea `.env` con secretos aleatorios (BD, JWT, almacenamiento y contraseña del administrador, que muestra por pantalla) y ejecuta `docker compose up -d --build`. Después abre <http://localhost:8080>.

También puedes hacerlo a mano: `cp .env.example .env`, editar los secretos y `docker compose up -d --build`.

## Arquitectura

```
Navegador ──► gateway (nginx, único puerto publicado)
                ├── /      ► frontend  (React + Vite, servido por nginx)
                └── /api   ► backend   (Spring Boot 3, Java 21)
                               ├── db     (PostgreSQL 16)         ┐ red interna,
                               └── minio  (almacén de archivos)   ┘ sin acceso a Internet
```

| Servicio | Tecnología | Notas |
|---|---|---|
| `gateway` | nginx | Rate limiting por IP (más estricto en `/api/auth`), cabeceras de seguridad/CSP, límites de tamaño, bloquea `/actuator`. |
| `frontend` | React + Vite + TypeScript | SPA estática. |
| `backend` | Spring Boot 3.4 / Java 21 | JWT, Flyway, validación, CORS configurable. |
| `db` | PostgreSQL 16 | Volumen `nora_pgdata`. Sin puerto publicado. |
| `minio` | MinIO (S3) | Volumen `nora_files`. Sin puerto publicado, bucket privado. |

### Seguridad

- **Autenticación propia** (registro + login): contraseñas con BCrypt (coste 12), política de contraseñas, bloqueo temporal tras 5 intentos fallidos, mensajes que no revelan si el email existe.
- **Sesiones**: access token JWT de 15 min (en memoria del navegador) + refresh token opaco en cookie `HttpOnly; SameSite=Strict`, guardado hasheado y **rotado en cada uso**; si se reutiliza uno ya rotado se cierran todas las sesiones del usuario.
- **Archivos**: MinIO solo es accesible desde el backend por la red interna. Cada descarga pasa por la API, que comprueba que el usuario participa en la sala; siempre se sirven como adjunto (`nosniff`), sin URLs prefirmadas. Al expirar o cerrarse una sala se borran todos sus archivos.
- **Contenedores**: sistema de ficheros de solo lectura, `cap_drop: ALL`, `no-new-privileges`, usuarios sin privilegios, red `internal` para datos.
- **CORS**: por defecto solo mismo origen (el gateway). Para otros orígenes: `NORA_ALLOWED_ORIGINS=https://app.ejemplo.com`.
- **HTTPS**: el stack escucha en HTTP (por defecto solo en `127.0.0.1`). En producción pon delante un proxy con TLS y define `NORA_COOKIE_SECURE=true` y `NORA_BIND=0.0.0.0`.

### Administración

El administrador inicial se crea con `NORA_ADMIN_EMAIL` / `NORA_ADMIN_PASSWORD`. En **Admin** puede, por usuario, activar/desactivar la cuenta, cambiar el rol y fijar o poner **infinito (∞)** en: espacio total, tamaño máximo de archivo, duración máxima de sala (y salas sin expiración), salas activas y participantes por sala. Los valores por defecto de usuarios nuevos se configuran en `.env`.

## Desarrollo

```bash
# Backend (necesita Postgres y MinIO; p. ej. docker compose up -d db minio con puertos temporales)
cd backend && mvn spring-boot:run

# Frontend con proxy a http://localhost:8080
cd frontend && npm install && npm run dev
```

## Estado

Herramientas operativas: **Archivos**, **Notas**, **Portapapeles**. Pizarra, Media Review, Asistencia, Votaciones y Acciones aparecen como «Próximamente». La presencia de participantes se calcula por latido (cada 10 s); WebSockets quedan como mejora futura.
