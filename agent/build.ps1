# Compila el agente de Nora para Windows y lo deja en agent\dist\nora-agent-windows.exe
# Uso (PowerShell):  .\agent\build.ps1      (requiere Rust: https://rustup.rs y las «Build Tools» de Visual Studio)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Host 'Falta Rust. Instálalo desde https://rustup.rs y vuelve a ejecutar este script.'
  exit 1
}
cargo build --release
New-Item -ItemType Directory -Force -Path dist | Out-Null
Copy-Item target\release\nora-agent.exe dist\nora-agent-windows.exe -Force
Write-Host 'Listo: agent\dist\nora-agent-windows.exe'
