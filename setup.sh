#!/usr/bin/env sh
# Genera .env con secretos aleatorios (si no existe) y levanta Nora.
set -eu
cd "$(dirname "$0")"

hex() { LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c "$1"; }
rand() { LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$1"; }

if [ ! -f .env ]; then
  ADMIN_PASS="$(rand 16)Aa1"
  sed -e "s|^NORA_DB_PASSWORD=.*|NORA_DB_PASSWORD=$(rand 32)|" \
      -e "s|^NORA_JWT_SECRET=.*|NORA_JWT_SECRET=$(rand 64)|" \
      -e "s|^NORA_GARAGE_RPC_SECRET=.*|NORA_GARAGE_RPC_SECRET=$(hex 64)|" \
      -e "s|^NORA_GARAGE_ADMIN_TOKEN=.*|NORA_GARAGE_ADMIN_TOKEN=$(rand 48)|" \
      -e "s|^NORA_ADMIN_PASSWORD=.*|NORA_ADMIN_PASSWORD=$ADMIN_PASS|" \
      .env.example > .env
  chmod 600 .env
  echo "Creado .env con secretos aleatorios."
  echo "Administrador: admin@nora.local / $ADMIN_PASS"
fi

# Si ya existía un .env de una versión anterior, se añaden solo las variables que falten.
ensure() {
  grep -Eq "^$1=.+" .env && return 0
  [ -n "$(tail -c1 .env)" ] && echo >> .env
  sed -i.bak "/^$1=/d" .env && rm -f .env.bak
  echo "$1=$2" >> .env
  echo "Añadido $1 a .env"
}
ensure NORA_GARAGE_RPC_SECRET "$(hex 64)"
ensure NORA_GARAGE_ADMIN_TOKEN "$(rand 48)"
ensure NORA_CONVERTER_TOKEN "$(rand 40)"
# Cualquier variable de .env.example que falte en tu .env (DeepSeek, descargas del agente, etc.) se añade vacía o con su valor por defecto,
# con sus comentarios, para que solo tengas que rellenarla. Nunca se toca lo que ya tienes.
awk 'NR==FNR { if ($0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) { split($0, kv, "="); have[kv[1]] = 1 } next }
  /^#/ { buf = buf $0 "\n"; next }
  /^[A-Za-z_][A-Za-z0-9_]*=/ { split($0, kv, "="); if (!(kv[1] in have) && $0 !~ /cambia|=0000000000/) { out = out (buf != "" ? "\n" : "") buf $0 "\n"; names = names " " kv[1] } buf = ""; next }
  { buf = "" }
  END { if (out != "") { printf "\n# --- Añadido por setup.sh: variables nuevas de esta versión ---\n%s", out; print "Añadido a .env:" names > "/dev/stderr" } }' .env .env.example >> .env.new
[ -s .env.new ] && cat .env.new >> .env
rm -f .env.new

# El repositorio de GitHub (para ofrecer el agente de Asistencia) se toma solo de este clon, si no lo has puesto tú.
if ! grep -Eq '^NORA_AGENT_REPO=.+' .env; then
  REPO="$(git remote get-url origin 2>/dev/null | sed -nE 's#.*github\.com[:/]([^/]+/[^/]+)$#\1#p' | sed -e 's#\.git$##')"
  if [ -n "$REPO" ]; then
    sed -i.bak "/^NORA_AGENT_REPO=/d" .env && rm -f .env.bak
    echo "NORA_AGENT_REPO=$REPO" >> .env
    echo "NORA_AGENT_REPO=$REPO (tomado de git)"
  fi
fi

docker compose up -d --build
PORT="$(grep -E '^NORA_PORT=' .env | cut -d= -f2 | cut -d' ' -f1)"
echo "Nora en http://localhost:${PORT:-29817}"
