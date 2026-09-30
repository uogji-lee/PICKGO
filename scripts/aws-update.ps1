param(
  [string]$KeyPath = "$env:USERPROFILE\Documents\서버키모음\pickgo.pem",
  [string]$ServerHost = '13.125.53.162',
  [string]$Branch
)
# GitHub에 push한 최신 코드를 AWS 서버에 반영합니다. (서버에서 DB 백업 → git pull → npm install → 재시작)
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\aws-update.ps1 [-Branch main]
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $KeyPath)) { throw "SSH key not found: $KeyPath (-KeyPath 로 지정)" }
& ssh -i $KeyPath -o ConnectTimeout=15 "ubuntu@$ServerHost" "sudo /usr/local/bin/pickgo-update $Branch"
if ($LASTEXITCODE -ne 0) { throw "Update failed (exit $LASTEXITCODE)" }
