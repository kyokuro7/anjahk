#!/usr/bin/env bash
# Pasang AI Agent + Cloudflare Tunnel otomatis (Ubuntu/Debian). Jalankan: sudo bash deploy/install.sh
set -euo pipefail
[ "$EUID" -eq 0 ] || { echo "Jalankan dengan sudo"; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"; APP=/opt/ai-agent
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y curl ca-certificates build-essential python3 gnupg
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs; fi
if ! command -v cloudflared >/dev/null; then
  ARCH=$(dpkg --print-architecture)
  curl -fsSL -o /tmp/cf.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
  dpkg -i /tmp/cf.deb; fi
id aiagent >/dev/null 2>&1 || useradd -r -m -d "$APP" -s /usr/sbin/nologin aiagent
mkdir -p "$APP"; cp -r "$SRC"/. "$APP"/; rm -rf "$APP/deploy/.git"
cd "$APP"; npm install --omit=dev
cat > "$APP/tunnel.sh" <<'T'
#!/usr/bin/env bash
set -a; . /opt/ai-agent/.env; set +a
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then exec cloudflared tunnel --no-autoupdate run --token "$CF_TUNNEL_TOKEN"
else exec cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT:-3000}"; fi
T
chmod +x tunnel.sh; mkdir -p data; chown -R aiagent:aiagent "$APP"; chmod 600 .env
cat > /etc/systemd/system/ai-agent.service <<S
[Unit]
Description=AI Agent
After=network-online.target
[Service]
User=aiagent
WorkingDirectory=$APP
ExecStart=$(command -v node) --env-file=$APP/.env server.js
Restart=always
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
S
cat > /etc/systemd/system/ai-agent-tunnel.service <<S
[Unit]
Description=Cloudflare Tunnel untuk AI Agent
After=ai-agent.service
Requires=ai-agent.service
[Service]
User=aiagent
ExecStart=$APP/tunnel.sh
Restart=always
[Install]
WantedBy=multi-user.target
S
systemctl daemon-reload; systemctl enable --now ai-agent ai-agent-tunnel
sleep 6
# Hapus password admin plaintext dari .env setelah di-hash ke database
sed -i '/^ADMIN_PASS=/d' "$APP/.env"
if grep -q '^CF_TUNNEL_TOKEN=.\+' "$APP/.env"; then echo "Tunnel permanen aktif. Buka domain yang kamu set di dashboard Cloudflare."; exit 0; fi
echo "Menunggu URL tunnel..."
for i in $(seq 1 30); do
  URL=$(journalctl -u ai-agent-tunnel --no-pager 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)
  [ -n "$URL" ] && { echo "$URL" > "$APP/tunnel-url.txt"; echo; echo "Website aktif: $URL"; exit 0; }; sleep 2; done
echo "URL belum muncul. Cek: journalctl -u ai-agent-tunnel -n 50"
