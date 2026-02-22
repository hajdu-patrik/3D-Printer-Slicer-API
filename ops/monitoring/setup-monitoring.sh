#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash ops/monitoring/setup-monitoring.sh"
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <monitor-domain> [project-dir]"
  echo "Required env vars: MONITOR_BASIC_AUTH_USER, MONITOR_BASIC_AUTH_PASSWORD"
  echo "Example: $0 monitor.3dslicer.api /home/deploy/3D-Printer-Slicer-API-for-FDM-and-SLA_JS"
  exit 1
fi

MONITOR_DOMAIN="$1"
PROJECT_DIR="${2:-$PWD}"
# Credentials used for Nginx Basic Auth in front of Uptime Kuma.
MONITOR_BASIC_AUTH_USER="${MONITOR_BASIC_AUTH_USER:-}"
MONITOR_BASIC_AUTH_PASSWORD="${MONITOR_BASIC_AUTH_PASSWORD:-}"

if [[ -z "$MONITOR_BASIC_AUTH_USER" || -z "$MONITOR_BASIC_AUTH_PASSWORD" ]]; then
  echo "Error: set MONITOR_BASIC_AUTH_USER and MONITOR_BASIC_AUTH_PASSWORD before running this script."
  echo "Example: MONITOR_BASIC_AUTH_USER=admin MONITOR_BASIC_AUTH_PASSWORD='StrongPassword123!' sudo bash ops/monitoring/setup-monitoring.sh monitor.example.com"
  exit 1
fi

if [[ ! -f "$PROJECT_DIR/docker-compose.yml" ]]; then
  echo "docker-compose.yml not found in: $PROJECT_DIR"
  exit 1
fi

echo "[1/6] Starting monitoring profile (Uptime Kuma)..."
docker compose -f "$PROJECT_DIR/docker-compose.yml" --profile monitoring up -d

echo "[2/6] Installing Nginx + Certbot if missing..."
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot python3-certbot-nginx

echo "[3/6] Writing Nginx site config for ${MONITOR_DOMAIN}..."
# Create dedicated htpasswd file for this monitoring domain.
HTPASSWD_FILE="/etc/nginx/.htpasswd-${MONITOR_DOMAIN}"
HASHED_PASSWORD="$(openssl passwd -apr1 "$MONITOR_BASIC_AUTH_PASSWORD")"
printf "%s:%s\n" "$MONITOR_BASIC_AUTH_USER" "$HASHED_PASSWORD" >"$HTPASSWD_FILE"
chmod 640 "$HTPASSWD_FILE"

cat >/etc/nginx/sites-available/${MONITOR_DOMAIN} <<EOF
server {
    listen 80;
    server_name ${MONITOR_DOMAIN};
  # Keep monitor uploads/requests tiny to reduce abuse surface.
  client_max_body_size 2m;

  # First protection layer for admin monitor endpoint.
  auth_basic "Restricted Monitoring";
  auth_basic_user_file ${HTPASSWD_FILE};

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
EOF

echo "[4/6] Enabling Nginx site..."
ln -sf /etc/nginx/sites-available/${MONITOR_DOMAIN} /etc/nginx/sites-enabled/${MONITOR_DOMAIN}
nginx -t
systemctl restart nginx

echo "[5/6] Requesting TLS certificate..."
certbot --nginx -d "${MONITOR_DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email --redirect || true

echo "[6/6] Verifying local monitor endpoint..."
curl -fsS http://127.0.0.1:3001 >/dev/null

echo "Done. Monitoring is available at: https://${MONITOR_DOMAIN}"
echo "Recommended next step: protect this domain with Cloudflare Access (Zero Trust)."
