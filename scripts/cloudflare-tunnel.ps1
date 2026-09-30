param([ValidateSet('Start','Stop','Status')][string]$Action = 'Start', [string]$TunnelName)
# Cloudflare Tunnel로 PICKGO를 외부에 공개합니다.
# - 기본: Quick Tunnel (무료, 도메인 불필요). 켤 때마다 https://xxxx.trycloudflare.com 주소가 바뀝니다.
#   새 주소를 .env의 PICKGO_PUBLIC_URL에 기록하고 PICKGO 서버를 재시작합니다.
# - -TunnelName 지정: ~/.cloudflared/config.yml 의 Named Tunnel 실행 (고정 도메인, PICKGO_PUBLIC_URL은 직접 설정)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runtimeDir = Join-Path $projectRoot 'data\runtime'
$pidFile = Join-Path $runtimeDir 'tunnel.pid'
$urlFile = Join-Path $runtimeDir 'tunnel.url'
$log = Join-Path $runtimeDir 'tunnel.log'
$envFile = Join-Path $projectRoot '.env'
$serverScript = Join-Path $PSScriptRoot 'local-server.ps1'
New-Item -ItemType Directory -Force $runtimeDir | Out-Null

function Get-TunnelProcess {
  if (!(Test-Path -LiteralPath $pidFile)) { return $null }
  $process = Get-Process -Id ([int](Get-Content -LiteralPath $pidFile)) -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq 'cloudflared') { return $process }
  Remove-Item -LiteralPath $pidFile -Force
  return $null
}

$running = Get-TunnelProcess
if ($Action -eq 'Status') {
  if ($running) {
    $url = if (Test-Path -LiteralPath $urlFile) { Get-Content -LiteralPath $urlFile } else { '(Named Tunnel)' }
    Write-Output "Tunnel running (PID $($running.Id)): $url"
  } else { Write-Output 'Tunnel not running.' }
  exit
}
if ($Action -eq 'Stop') {
  # PID 파일에 기록된 이 스크립트의 cloudflared만 종료 (다른 터널·프로세스는 건드리지 않음)
  if ($running) { Stop-Process -Id $running.Id; Remove-Item -LiteralPath $pidFile -Force; Write-Output 'Tunnel stopped.' } else { Write-Output 'No PICKGO tunnel found.' }
  if (Test-Path -LiteralPath $urlFile) { Remove-Item -LiteralPath $urlFile -Force }
  exit
}
if ($running) { Write-Output "Already running (PID $($running.Id)). Stop first to get a new address."; exit }

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (!$cloudflared) { $cloudflared = @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 }
if (!$cloudflared) { throw 'cloudflared not found. Install: winget install --id Cloudflare.cloudflared' }

$port = 3000
if (Test-Path -LiteralPath $envFile) {
  $portLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^PORT=\d+$' } | Select-Object -Last 1
  if ($portLine) { $port = [int]($portLine -replace '^PORT=', '') }
}

if ($TunnelName) {
  $process = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--no-autoupdate', '--logfile', "`"$log`"", 'run', $TunnelName) -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $pidFile -Value $process.Id
  & $serverScript Start
  Write-Output "Named tunnel '$TunnelName' started (PID $($process.Id)). Logs: data/runtime/tunnel.log"
  exit
}

if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }
$process = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--no-autoupdate', '--logfile', "`"$log`"", '--url', "http://localhost:$port") -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id
$url = $null
for ($i = 0; $i -lt 60 -and !$url; $i++) {
  Start-Sleep -Seconds 1
  if ($process.HasExited) { break }
  if (Test-Path -LiteralPath $log) {
    $match = Select-String -LiteralPath $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($match) { $url = $match.Matches[0].Value }
  }
}
if (!$url) {
  if (!$process.HasExited) { Stop-Process -Id $process.Id }
  Remove-Item -LiteralPath $pidFile -Force
  throw 'Could not get a Quick Tunnel address. Check data/runtime/tunnel.log'
}
Set-Content -LiteralPath $urlFile -Value $url

# .env의 PICKGO_PUBLIC_URL을 새 주소로 교체 (나머지 줄은 그대로 유지)
$lines = if (Test-Path -LiteralPath $envFile) { @(Get-Content -LiteralPath $envFile | Where-Object { $_ -notmatch '^PICKGO_PUBLIC_URL=' }) } else { @() }
[IO.File]::WriteAllLines($envFile, [string[]]($lines + "PICKGO_PUBLIC_URL=$url"), (New-Object Text.UTF8Encoding $false))

# 서버가 새 주소를 읽도록 재시작
& $serverScript Stop | Out-Null
for ($i = 0; $i -lt 15 -and (Test-Path -LiteralPath (Join-Path $runtimeDir 'supervisor.pid')); $i++) { Start-Sleep -Seconds 1 }
& $serverScript Start
Write-Output "PICKGO public address: $url"
