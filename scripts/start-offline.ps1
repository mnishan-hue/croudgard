param([ValidateRange(1, 65535)][int]$Port = 8000)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendIndex = Join-Path $repoRoot 'artifacts\crowdguard-sentinel\dist\public\index.html'

if (-not (Test-Path -LiteralPath $frontendIndex -PathType Leaf)) {
  throw 'Offline frontend missing. Run "pnpm run offline:build" before disconnecting.'
}

$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
  $python = $venvPython
} else {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($null -eq $pythonCommand) {
    throw 'Python not found. Install backend requirements before disconnecting.'
  }
  $python = $pythonCommand.Source
}

if ([string]::IsNullOrWhiteSpace($env:CROWDGUARD_DB_PATH)) {
  $env:CROWDGUARD_DB_PATH = Join-Path $repoRoot 'backend\crowdguard.db'
}
if ([string]::IsNullOrWhiteSpace($env:CROWDGUARD_AI_PROVIDER)) {
  $env:CROWDGUARD_AI_PROVIDER = 'mock'
}
if ([string]::IsNullOrWhiteSpace($env:CROWDGUARD_HARDWARE_PROVIDER)) {
  $env:CROWDGUARD_HARDWARE_PROVIDER = 'mock'
}

Set-Location -LiteralPath $repoRoot
Write-Host "CrowdGuard Sentinel offline at http://127.0.0.1:$Port"
& $python -m uvicorn backend.main:app --host 127.0.0.1 --port $Port
exit $LASTEXITCODE
