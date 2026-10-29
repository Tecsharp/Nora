#!/bin/sh
# Doble clic en macOS: compila el agente de Nora y lo deja en agent/dist/nora-agent-macos
cd "$(dirname "$0")"
./build.sh
echo
echo "Pulsa Enter para cerrar."
read _
