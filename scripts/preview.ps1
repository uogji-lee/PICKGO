param(
  [string]$KeyPath = "$env:USERPROFILE\Documents\서버키모음\pickgo.pem",
  [string]$ServerHost = '13.125.53.162',
  [int]$Port = 3100,
  [switch]$Fresh
)
# 서버에 반영하기 전에 현재 코드를 내 PC에서 미리 실행합니다.
# - 기본: AWS 서버 DB의 '복사본'을 받아와 실제 방·계정으로 확인 (서버 DB는 바뀌지 않음)
# - -Fresh: 빈 DB로 실행
# 실행 후 http://localhost:3100 접속, 끝내려면 이 창에서 Ctrl+C
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$db = Join-Path $projectRoot 'data\preview-pickgo.db'
Remove-Item -LiteralPath $db, "$db-wal", "$db-shm" -Force -ErrorAction SilentlyContinue

if (!$Fresh) {
  if (!(Test-Path -LiteralPath $KeyPath)) { throw "SSH key not found: $KeyPath (-KeyPath 로 지정하거나 -Fresh 사용)" }
  Write-Output 'Copying server DB snapshot (read-only on server)...'
  & ssh -i $KeyPath -o ConnectTimeout=15 "ubuntu@$ServerHost" "sudo sqlite3 /var/lib/pickgo/pickgo.db '.backup /tmp/pickgo-preview.db' && sudo chmod 644 /tmp/pickgo-preview.db"
  if ($LASTEXITCODE -ne 0) { throw 'Could not snapshot server DB.' }
  & scp -q -i $KeyPath "ubuntu@${ServerHost}:/tmp/pickgo-preview.db" $db
  $copied = $LASTEXITCODE
  & ssh -i $KeyPath "ubuntu@$ServerHost" 'sudo rm -f /tmp/pickgo-preview.db'
  if ($copied -ne 0) { throw 'Could not download DB snapshot.' }
}

# 미리보기 전용 설정 (.env의 운영 설정보다 우선)
$env:NODE_ENV = 'development'
$env:HOST = '127.0.0.1'
$env:PORT = "$Port"
$env:PICKGO_DB_PATH = $db
$env:PICKGO_PUBLIC_URL = "http://localhost:$Port"
$env:PICKGO_TRUST_PROXY = '0'
$env:PICKGO_JWT_SECRET = 'preview-only-secret-not-used-in-production-0123456789'
Write-Output "Preview: http://localhost:$Port  (Ctrl+C to stop)"
Push-Location $projectRoot
try { & node server.js } finally { Pop-Location }
