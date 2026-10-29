#!/bin/sh
# Compila el agente de Nora para ESTE equipo (Linux o macOS) y lo deja en agent/dist/ con el nombre que Nora ofrece para descargar.
# Uso:  ./agent/build.sh            (requiere Rust: https://rustup.rs ; en Linux además libxkbcommon-dev)
#       ./agent/build.sh windows    (desde Linux/macOS: compila el .exe de Windows; requiere el compilador mingw-w64)
set -e
cd "$(dirname "$0")"
command -v cargo >/dev/null 2>&1 || { echo "Falta Rust. Instálalo desde https://rustup.rs y vuelve a ejecutar este script."; exit 1; }
mkdir -p dist
if [ "$1" = "windows" ]; then
  rustup target add x86_64-pc-windows-gnu
  command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1 || { echo "Falta mingw-w64 (Debian/Ubuntu: apt install gcc-mingw-w64-x86-64 · macOS: brew install mingw-w64)."; exit 1; }
  CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc cargo build --release --target x86_64-pc-windows-gnu
  cp target/x86_64-pc-windows-gnu/release/nora-agent.exe dist/nora-agent-windows.exe
  echo "Listo: agent/dist/nora-agent-windows.exe"
  exit 0
fi
cargo build --release
case "$(uname -s)" in
  Darwin) cp target/release/nora-agent dist/nora-agent-macos; echo "Listo: agent/dist/nora-agent-macos" ;;
  Linux)  cp target/release/nora-agent dist/nora-agent-linux; echo "Listo: agent/dist/nora-agent-linux" ;;
  *)      echo "Sistema no reconocido: usa agent/build.ps1 en Windows"; exit 1 ;;
esac
