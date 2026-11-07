#!/usr/bin/env bash
pkill -f "node --env-file" ; pkill -f "ai-agent/tunnel.sh" ; pkill -f "cloudflared tunnel"; exit 0
