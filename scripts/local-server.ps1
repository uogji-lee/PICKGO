param([ValidateSet('Start','Stop','Status')][string]$Action = 'Start', [string]$NodePath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runtimeDir = Join-Path $projectRoot 'data\runtime'
$port = 3000
$envFile = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $envFile) {
  $portLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^PORT=\d+$' } | Select-Object -Last 1
  if ($portLine) { $port = [int]($portLine -replace '^PORT=', '') }
}
$url = "http://localhost:$port"
$health = $null
try { $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 3 } catch {}
if ($Action -eq 'Status') {
  if ($health.service -eq 'PICKGO') { Write-Output "PICKGO running: $url" } else { Write-Output "PICKGO not responding: $url" }
  exit
}
if ($Action -eq 'Stop') {
  if (Test-Path -LiteralPath (Join-Path $runtimeDir 'supervisor.pid')) {
    New-Item -Path (Join-Path $runtimeDir 'stop') -ItemType File -Force | Out-Null
    Write-Output 'PICKGO supervisor stop requested (no other project is stopped).'
  } else { Write-Output 'No PICKGO supervisor found.' }
  exit
}
if ($health.service -eq 'PICKGO') { Write-Output "Already running: $url"; exit }
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw "Port $port is occupied by PID $($listener.OwningProcess -join ','). No process was stopped. Check OAuth URLs before changing ports." }
if (!$NodePath) {
  $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  $command = Get-Command node -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $bundledNode) { $NodePath = $bundledNode }
  elseif ($command) { $NodePath = $command.Source }
}
if (!(Test-Path -LiteralPath $NodePath)) { throw 'Node.js not found. Provide -NodePath.' }
Push-Location $projectRoot
try { & $NodePath -e "const D=require('better-sqlite3'); new D(':memory:').close(); if(+process.versions.node.split('.')[0]<20)process.exit(1)"; if ($LASTEXITCODE -ne 0) { throw 'Node runtime/native SQLite mismatch. Use Node 24 or rebuild dependencies for your Node version.' } }
finally { Pop-Location }
# WMI starts outside the interactive terminal's process lifetime, with no visible window.
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = ('"{0}" "{1}"' -f $NodePath, (Join-Path $PSScriptRoot 'local-supervisor.cjs'))
  CurrentDirectory = $projectRoot
  ProcessStartupInformation = $startup
}
if ($result.ReturnValue -ne 0) { throw "Could not start background server: $($result.ReturnValue)" }
Write-Output "PICKGO supervisor started (PID $($result.ProcessId)): $url. Logs: data/runtime/server.log"
