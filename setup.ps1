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
  $text = $text -replace '(?m)^NORA_MINIO_ACCESS_KEY=.*', "NORA_MINIO_ACCESS_KEY=nora$(New-Secret 8)"
  $text = $text -replace '(?m)^NORA_MINIO_SECRET_KEY=.*', "NORA_MINIO_SECRET_KEY=$(New-Secret 40)"
  $text = $text -replace '(?m)^NORA_ADMIN_PASSWORD=.*', "NORA_ADMIN_PASSWORD=$admin"
  Set-Content .env $text -NoNewline
  Write-Host "Creado .env con secretos aleatorios."
  Write-Host "Administrador: admin@nora.local / $admin"
}

docker compose up -d --build
Write-Host "Nora en http://localhost:8080"
