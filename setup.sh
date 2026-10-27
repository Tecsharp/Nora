#!/usr/bin/env sh
# Genera .env con secretos aleatorios (si no existe) y levanta Nora.
set -eu
cd "$(dirname "$0")"

rand() { LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$1"; }

if [ ! -f .env ]; then
  ADMIN_PASS="$(rand 16)Aa1"
  sed -e "s|^NORA_DB_PASSWORD=.*|NORA_DB_PASSWORD=$(rand 32)|" \
      -e "s|^NORA_JWT_SECRET=.*|NORA_JWT_SECRET=$(rand 64)|" \
      -e "s|^NORA_MINIO_ACCESS_KEY=.*|NORA_MINIO_ACCESS_KEY=nora$(rand 8)|" \
      -e "s|^NORA_MINIO_SECRET_KEY=.*|NORA_MINIO_SECRET_KEY=$(rand 40)|" \
      -e "s|^NORA_ADMIN_PASSWORD=.*|NORA_ADMIN_PASSWORD=$ADMIN_PASS|" \
      .env.example > .env
  chmod 600 .env
  echo "Creado .env con secretos aleatorios."
  echo "Administrador: admin@nora.local / $ADMIN_PASS"
fi

docker compose up -d --build
PORT="$(grep -E '^NORA_PORT=' .env | cut -d= -f2 | cut -d' ' -f1)"
echo "Nora en http://localhost:${PORT:-8080}"
