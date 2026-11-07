#!/usr/bin/env bash
# Jalankan app + Cloudflare Tunnel tanpa systemd (auto-restart via loop, auto-start saat reboot via cron).
[ "$EUID" -eq 0 ] || { echo "Jalankan dengan sudo"; exit 1; }
APP=/opt/ai-agent; cd "$APP"; mkdir -p logs data; chown -R aiagent:aiagent logs data
bash "$APP/deploy/stop.sh" >/dev/null 2>&1; : > logs/tunnel.log
NODE=$(command -v node)
nohup setsid runuser -u aiagent -- bash -c "while true; do $NODE --env-file=$APP/.env server.js >> logs/app.log 2>&1; sleep 2; done" >/dev/null 2>&1 &
sleep 4
nohup setsid runuser -u aiagent -- bash -c "while true; do $APP/tunnel.sh >> logs/tunnel.log 2>&1; sleep 3; done" >/dev/null 2>&1 &
# auto-start saat reboot (jika cron tersedia)
if command -v crontab >/dev/null; then (crontab -l 2>/dev/null | grep -v 'ai-agent/deploy/start.sh'; echo "@reboot sleep 15 && bash $APP/deploy/start.sh") | crontab -; fi
sed -i '/^ADMIN_PASS=/d' "$APP/.env"
if grep -q '^CF_TUNNEL_TOKEN=.\+' "$APP/.env"; then echo "Tunnel permanen aktif. Buka domain dari dashboard Cloudflare."; exit 0; fi
echo "Menunggu URL tunnel..."
for i in $(seq 1 30); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' logs/tunnel.log | tail -1 || true)
  [ -n "$URL" ] && { echo "$URL" > tunnel-url.txt; echo; echo "Website aktif: $URL"; exit 0; }; sleep 2; done
echo "URL belum muncul. Cek: tail -n 50 $APP/logs/tunnel.log  dan  $APP/logs/app.log"
