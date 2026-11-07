# AI Agent
Deploy di VPS (Ubuntu/Debian): `unzip ai-agent.zip && cd ai-agent && sudo bash deploy/install.sh`
- Website otomatis jalan via systemd (auto-restart) dan diekspos lewat Cloudflare Tunnel; URL ditampilkan di akhir install (`/opt/ai-agent/tunnel-url.txt`).
- Quick tunnel (trycloudflare) berganti URL tiap restart. Untuk URL tetap: isi `CF_TUNNEL_TOKEN` di `.env` (token dari Cloudflare Zero Trust) lalu `sudo systemctl restart ai-agent-tunnel`.
- Database SQLite: `/opt/ai-agent/data/app.db`. Backup: salin folder `data/`.
- Login awal: adminn1 / 200309 → segera ganti di Pengaturan admin > Password.
