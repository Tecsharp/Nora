# Genera .env con secretos aleatorios (si no existe) y levanta Nora.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function New-Secret([int]$n) {
  -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ })
}

if (-not (Test-Path .env)) {
  $admin = (New-Secret 16) + 'Aa1'
  $text = Get-Content .env.example -Raw
  $text = $text -replace '(?m)^NORA_DB_PASSWORD=.*', "NORA_DB_PASSWORD=$(New-Secret 32)"
  $text = $text -replace '(?m)^NORA_JWT_SECRET=.*', "NORA_JWT_SECRET=$(New-Secret 64)"
  $hex = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  $text = $text -replace '(?m)^NORA_GARAGE_RPC_SECRET=.*', "NORA_GARAGE_RPC_SECRET=$hex"
  $text = $text -replace '(?m)^NORA_GARAGE_ADMIN_TOKEN=.*', "NORA_GARAGE_ADMIN_TOKEN=$(New-Secret 48)"
  $text = $text -replace '(?m)^NORA_ADMIN_PASSWORD=.*', "NORA_ADMIN_PASSWORD=$admin"
  Set-Content .env $text -NoNewline
  Write-Host "Creado .env con secretos aleatorios."
  Write-Host "Administrador: admin@nora.local / $admin"
}

# Si ya existía un .env de una versión anterior, se añaden solo las variables que falten.
function Ensure-Var([string]$name, [string]$value) {
  if (Select-String -Path .env -Pattern "^$name=.+" -Quiet) { return }
  $lines = @(Get-Content .env | Where-Object { $_ -notmatch "^$name=" })
  $lines += "$name=$value"
  Set-Content .env $lines
  Write-Host "Añadido $name a .env"
}
Ensure-Var 'NORA_GARAGE_RPC_SECRET' (-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }))
Ensure-Var 'NORA_GARAGE_ADMIN_TOKEN' (New-Secret 48)
Ensure-Var 'NORA_CONVERTER_TOKEN' (New-Secret 40)
# Cualquier variable de .env.example que falte en tu .env (DeepSeek, descargas del agente, etc.) se añade vacía o con su valor por defecto,
# con sus comentarios, para que solo tengas que rellenarla. Nunca se toca lo que ya tienes.
$have = @{}
Get-Content .env | ForEach-Object { if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=') { $have[$Matches[1]] = $true } }
$buf = @(); $out = @(); $names = @()
foreach ($line in Get-Content .env.example) {
  if ($line -match '^#') { $buf += $line; continue }
  if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=') {
    # los secretos con valor de ejemplo («cambia…») nunca se copian: los genera este script
    if (-not $have.ContainsKey($Matches[1]) -and $line -notmatch 'cambia|=0000000000') { if ($buf.Count) { $out += '' }; $out += $buf; $out += $line; $names += $Matches[1] }
  }
  $buf = @()
}
if ($out.Count -gt 0) {
  Add-Content .env ''
  Add-Content .env '# --- Añadido por setup.ps1: variables nuevas de esta versión ---'
  Add-Content .env $out
  Write-Host ("Añadido a .env: " + ($names -join ' '))
}

# El repositorio de GitHub (para ofrecer el agente de Asistencia) se toma solo de este clon, si no lo has puesto tú.
if (-not (Select-String -Path .env -Pattern '^NORA_AGENT_REPO=.+' -Quiet)) {
  $remote = (git remote get-url origin 2>$null)
  if ($remote -match 'github\.com[:/]([^/]+/[^/]+?)(\.git)?$') {
    $repo = $Matches[1]
    $lines = @(Get-Content .env | Where-Object { $_ -notmatch '^NORA_AGENT_REPO=' })
    $lines += "NORA_AGENT_REPO=$repo"
    Set-Content .env $lines
    Write-Host "NORA_AGENT_REPO=$repo (tomado de git)"
  }
}

docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
  Write-Host "Error al levantar Nora (revisa los mensajes de arriba)." -ForegroundColor Red
  exit $LASTEXITCODE
}
$port = (Select-String -Path .env -Pattern '^NORA_PORT=(\d+)').Matches.Groups[1].Value
if (-not $port) { $port = '29817' }
Write-Host "Nora en http://localhost:$port"
