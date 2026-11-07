#!/usr/bin/env bash
A=/opt/ai-agent
echo "== proses =="; pgrep -af "node --env-file|cloudflared" || echo "TIDAK ADA proses berjalan"
echo "== cek app lokal =="; curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3000/ || echo "App tidak merespon"
echo "== app.log =="; tail -n 15 $A/logs/app.log 2>/dev/null
echo "== tunnel.log =="; tail -n 15 $A/logs/tunnel.log 2>/dev/null
echo "== koneksi keluar =="; curl -sI -m 8 https://api.trycloudflare.com | head -1 || echo "Tidak bisa akses trycloudflare"
