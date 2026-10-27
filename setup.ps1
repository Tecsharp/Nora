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

docker compose up -d --build
Write-Host "Nora en http://localhost:8080"
