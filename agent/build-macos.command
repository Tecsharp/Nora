#!/bin/sh
# Doble clic en macOS: compila Nora Agent (universal: Apple Silicon + Intel) y lo deja en agent/dist/
# Si macOS no lo abre: clic derecho → Abrir, o en Terminal: chmod +x agent/build-macos.command
cd "$(dirname "$0")"
./build.sh
echo
echo "Pulsa Enter para cerrar."
read _
