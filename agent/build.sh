#!/bin/sh
# Compila Nora Agent para ESTE equipo (Linux o macOS) y lo deja en agent/dist/ con el nombre que Nora ofrece para descargar.
# Uso:  ./agent/build.sh            (requiere Rust: https://rustup.rs)
#         · macOS: genera una app «universal» (Apple Silicon + Intel) lista para usar: agent/dist/nora-agent-macos.zip (contiene «Nora Agent.app»)
#         · Linux: agent/dist/nora-agent-linux (necesita un compilador de C: build-essential)
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

case "$(uname -s)" in
  Linux)
    command -v cc >/dev/null 2>&1 || { echo "Falta un compilador de C. En Debian/Ubuntu: sudo apt install build-essential pkg-config   ·   Fedora: sudo dnf install gcc pkgconf"; exit 1; }
    cargo build --release
    cp target/release/nora-agent dist/nora-agent-linux
    echo "Listo: agent/dist/nora-agent-linux"
    ;;
  Darwin)
    # Un solo programa que sirve en Mac con Apple Silicon y con Intel
    if rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null 2>&1; then
      cargo build --release --target aarch64-apple-darwin
      cargo build --release --target x86_64-apple-darwin
      lipo -create -output target/nora-agent-universal target/aarch64-apple-darwin/release/nora-agent target/x86_64-apple-darwin/release/nora-agent
      BIN=target/nora-agent-universal
    else
      echo "No se pudieron añadir los dos destinos de Rust; se compila solo para este Mac."
      cargo build --release
      BIN=target/release/nora-agent
    fi
    APP="dist/Nora Agent.app"
    rm -rf "$APP"
    mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
    cp "$BIN" "$APP/Contents/MacOS/nora-agent"
    # Icono: lo dibuja el propio programa (no hay imágenes que mantener)
    ICONSET="target/AppIcon.iconset"
    rm -rf "$ICONSET" && mkdir -p "$ICONSET"
    "$BIN" --write-icon target/icon-1024.png --size 1024
    for s in 16 32 128 256 512; do
      sips -z $s $s target/icon-1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
      sips -z $((s * 2)) $((s * 2)) target/icon-1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
    done
    iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
    VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
    cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Nora Agent</string>
  <key>CFBundleDisplayName</key><string>Nora Agent</string>
  <key>CFBundleIdentifier</key><string>app.nora.agent</string>
  <key>CFBundleExecutable</key><string>nora-agent</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Nora Agent muestra avisos cuando alguien empieza o deja de controlar tu equipo.</string>
</dict></plist>
PLIST
    # Firma «ad hoc» (sin cuenta de Apple): hace que el sistema recuerde el permiso de Accesibilidad de esta app
    codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "Aviso: no se pudo firmar la app (codesign). Funcionará igual, pero puede pedir el permiso más veces."
    rm -f dist/nora-agent-macos.zip
    ditto -c -k --keepParent "$APP" dist/nora-agent-macos.zip
    echo "Listo: agent/dist/Nora Agent.app  y  agent/dist/nora-agent-macos.zip (es lo que Nora ofrece para descargar)"
    ;;
  *)
    echo "Sistema no reconocido: usa agent/build.ps1 en Windows"
    exit 1
    ;;
esac
