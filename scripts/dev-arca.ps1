param(
  [Parameter(Mandatory=$true)][string]$CertificatePath,
  [Parameter(Mandatory=$true)][string]$PrivateKeyPath,
  [Parameter(Mandatory=$true)][string]$ServiceAccountPath,
  [string]$IssuerCuit = "20233280799",
  [int]$PointOfSale = 3,
  [int]$Port = 8888,
  [int]$VitePort = 5173,
  [decimal]$ConsumerFinalThreshold = 0
)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
foreach ($credentialPath in @($CertificatePath, $PrivateKeyPath, $ServiceAccountPath)) {
  $resolvedCredential = (Resolve-Path -LiteralPath $credentialPath).Path
  if ($resolvedCredential.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Guardá las credenciales fuera del repositorio antes de iniciar."
  }
}
$names = @("ARCA_ENVIRONMENT", "ARCA_ISSUER_CUIT", "ARCA_POINT_OF_SALE", "ARCA_CERTIFICATE_PEM", "ARCA_PRIVATE_KEY_PEM", "FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_ADMIN_PRIVATE_KEY", "ARCA_CONSUMER_FINAL_ID_THRESHOLD", "ARCA_LOCAL_AUDIT_LOG", "NODE_OPTIONS")
$original = @{}
foreach ($name in $names) { $original[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
Push-Location $projectRoot
try {
  $account = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $ServiceAccountPath).Path) | ConvertFrom-Json
  if ($account.project_id -ne "app-integral-fm" -or [string]::IsNullOrWhiteSpace($account.private_key) -or [string]::IsNullOrWhiteSpace($account.client_email)) { throw "La cuenta de servicio no corresponde al proyecto o está incompleta." }
  $env:ARCA_ENVIRONMENT = "homologation"
  $env:ARCA_ISSUER_CUIT = $IssuerCuit
  $env:ARCA_POINT_OF_SALE = [string]$PointOfSale
  $env:ARCA_CERTIFICATE_PEM = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $CertificatePath).Path)
  $env:ARCA_PRIVATE_KEY_PEM = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $PrivateKeyPath).Path)
  $env:FIREBASE_ADMIN_CLIENT_EMAIL = $account.client_email
  $env:FIREBASE_ADMIN_PRIVATE_KEY = $account.private_key
  if ($ConsumerFinalThreshold -gt 0) { $env:ARCA_CONSUMER_FINAL_ID_THRESHOLD = $ConsumerFinalThreshold.ToString([Globalization.CultureInfo]::InvariantCulture) }
  $guardPath = Join-Path $PSScriptRoot "arca-local-readonly-guard.mjs"
  $guardUri = ([Uri]$guardPath).AbsoluteUri
  $env:NODE_OPTIONS = "$($original['NODE_OPTIONS']) --import=$guardUri".Trim()
  $auditDirectory = Join-Path $projectRoot ".netlify"
  [IO.Directory]::CreateDirectory($auditDirectory) | Out-Null
  $env:ARCA_LOCAL_AUDIT_LOG = Join-Path $auditDirectory "arca-local-readonly-audit.jsonl"
  Write-Host "Homologación local: credenciales en memoria, emisión bloqueada por guardia de diagnóstico."
  Write-Host "Abrí http://localhost:$Port/gestion/settings . Ctrl+C para detener."
  & npm exec --yes --package=netlify-cli@27.10.0 -- netlify dev --offline --no-open --skip-gitignore --port $Port --framework "#custom" --target-port $VitePort --command "npm run dev -- --host 127.0.0.1 --port $VitePort --strictPort"
  if ($LASTEXITCODE -ne 0) { throw "Netlify Dev terminó con error." }
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $original[$name], "Process") }
  Pop-Location
}
