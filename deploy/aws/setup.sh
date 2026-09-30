#!/usr/bin/env bash
# PICKGO를 Ubuntu 24.04 EC2에 설치합니다 (여러 번 실행해도 안전).
# 사용: sudo bash setup.sh <도메인> [브랜치]   예) sudo bash setup.sh 13-125-53-162.sslip.io main
set -euo pipefail

DOMAIN="${1:?도메인을 입력하세요. 예: 13-125-53-162.sslip.io}"
BRANCH="${2:-main}"
REPO="https://github.com/uogji-lee/PICKGO.git"
APP_DIR=/opt/pickgo/app
DATA_DIR=/var/lib/pickgo
BACKUP_DIR=/var/backups/pickgo

echo "==> 스왑 1GB (메모리 1GB 인스턴스의 npm install 안정성)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> 기본 패키지 · 시간대"
timedatectl set-timezone Asia/Seoul
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y curl git sqlite3 ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

echo "==> Node.js 24"
if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

echo "==> Caddy (HTTPS 자동 발급 리버스 프록시)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
fi

echo "==> 앱 계정 · 코드 ($BRANCH)"
id pickgo >/dev/null 2>&1 || useradd --system --home-dir /opt/pickgo --create-home --shell /usr/sbin/nologin pickgo
install -d -o pickgo -g pickgo -m 750 "$DATA_DIR"
install -d -o root -g root -m 700 "$BACKUP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  sudo -u pickgo git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
else
  sudo -u pickgo git -C "$APP_DIR" fetch origin "$BRANCH"
  sudo -u pickgo git -C "$APP_DIR" checkout "$BRANCH"
  sudo -u pickgo git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi
(cd "$APP_DIR" && sudo -u pickgo npm install --omit=dev --no-audit --no-fund)

echo "==> .env (최초 1회 생성, 비밀키는 이 서버에서 새로 생성)"
if [ ! -f "$APP_DIR/.env" ]; then
  umask 077
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PICKGO_PUBLIC_URL=https://$DOMAIN
PICKGO_JWT_SECRET=$(openssl rand -hex 48)
PICKGO_TRUST_PROXY=1
PICKGO_DB_PATH=$DATA_DIR/pickgo.db
EOF
  chown pickgo:pickgo "$APP_DIR/.env"
fi

echo "==> systemd 서비스"
cat > /etc/systemd/system/pickgo.service <<EOF
[Unit]
Description=PICKGO
After=network-online.target
Wants=network-online.target

[Service]
User=pickgo
Group=pickgo
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR $APP_DIR/data

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable pickgo
systemctl restart pickgo

echo "==> Caddy 설정"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy || systemctl restart caddy

echo "==> 백업 · 업데이트 명령"
cat > /usr/local/bin/pickgo-backup <<EOF
#!/usr/bin/env bash
# SQLite 온라인 백업 (WAL 사용 중에도 안전), 14일 보관
set -euo pipefail
[ -f $DATA_DIR/pickgo.db ] || exit 0
sqlite3 $DATA_DIR/pickgo.db ".backup '$BACKUP_DIR/pickgo-\$(date +%F-%H%M%S).db'"
find $BACKUP_DIR -name 'pickgo-*.db' -mtime +14 -delete
EOF
cat > /usr/local/bin/pickgo-update <<EOF
#!/usr/bin/env bash
# DB 백업 → 최신 코드 받기 → 의존성 설치 → 재시작 → 상태 확인
set -euo pipefail
BRANCH="\${1:-\$(sudo -u pickgo git -C $APP_DIR rev-parse --abbrev-ref HEAD)}"
/usr/local/bin/pickgo-backup
sudo -u pickgo git -C $APP_DIR fetch origin "\$BRANCH"
sudo -u pickgo git -C $APP_DIR checkout "\$BRANCH"
sudo -u pickgo git -C $APP_DIR pull --ff-only origin "\$BRANCH"
(cd $APP_DIR && sudo -u pickgo npm install --omit=dev --no-audit --no-fund)
systemctl restart pickgo
for i in \$(seq 1 20); do
  if curl -fs http://127.0.0.1:3000/api/health >/dev/null; then echo "업데이트 완료: \$(sudo -u pickgo git -C $APP_DIR log --oneline -1)"; exit 0; fi
  sleep 1
done
echo "서버가 응답하지 않습니다. journalctl -u pickgo -n 50 으로 확인하세요." >&2; exit 1
EOF
chmod 755 /usr/local/bin/pickgo-backup /usr/local/bin/pickgo-update
echo '0 4 * * * root /usr/local/bin/pickgo-backup' > /etc/cron.d/pickgo-backup

echo "==> 상태 확인"
for i in $(seq 1 20); do curl -fs http://127.0.0.1:3000/api/health && echo && break; sleep 1; done
systemctl --no-pager --lines=0 status pickgo caddy | grep -E '●|Active'
echo "완료: https://$DOMAIN"
