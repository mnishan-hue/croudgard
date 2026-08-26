param([ValidateRange(1, 65535)][int]$Port = 8000)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendIndex = Join-Path $repoRoot 'artifacts\crowdguard-sentinel\dist\public\index.html'

if (-not (Test-Path -LiteralPath $frontendIndex -PathType Leaf)) {
  throw 'Offline frontend missing. Run "pnpm run offline:build" before disconnecting.'
}

$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
$codexPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$pythonCandidates = @($venvPython, $codexPython)
foreach ($commandName in @('python', 'python3')) {
  foreach ($command in @(Get-Command $commandName -All -ErrorAction SilentlyContinue)) {
    if ($command.Source -and $command.Source -notlike '*\WindowsApps\*') {
      $pythonCandidates += $command.Source
    }
  }
}

$python = $pythonCandidates |
  Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
  Select-Object -First 1

if ([string]::IsNullOrWhiteSpace($python)) {
  throw 'A working Python runtime was not found. Create .venv and install backend/requirements.txt before disconnecting.'
}

& $python -c 'import fastapi, uvicorn' 2>$null
if ($LASTEXITCODE -ne 0) {
  throw 'The selected Python runtime is missing FastAPI or Uvicorn. Install backend/requirements.txt into .venv.'
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
