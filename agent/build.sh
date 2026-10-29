#!/bin/sh
# Compila el agente para este equipo y lo deja en agent/dist/ con el nombre que Nora ofrece para descargar.
# Requiere Rust (https://rustup.rs). En Linux: libxkbcommon-dev (y libxdo-dev).
set -e
cd "$(dirname "$0")"
cargo build --release
mkdir -p dist
case "$(uname -s)" in
  Darwin) cp target/release/nora-agent dist/nora-agent-macos ;;
  Linux)  cp target/release/nora-agent dist/nora-agent-linux ;;
  *)      cp target/release/nora-agent.exe dist/nora-agent-windows.exe ;;
esac
echo "Listo: agent/dist/"
