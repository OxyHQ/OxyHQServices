#!/usr/bin/env bash
##
## One-time setup script for a DigitalOcean Droplet
##
## Installs Docker, clones the repo, creates a deploy user, configures
## the firewall, and gives you the next steps.
##
## Run on a fresh Ubuntu 22.04+ Droplet:
##   ssh root@your-droplet-ip
##   bash setup-droplet.sh
##

set -euo pipefail

REPO_URL="${1:-https://github.com/OxyHQ/OxyHQServices.git}"
DEPLOY_DIR="/opt/oxy"

echo ""
echo "=== Oxy Platform — Droplet Setup ==="
echo ""

# ─── System updates ──────────────────────────────────────────────
echo "[1/6] Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# ─── Install Docker ──────────────────────────────────────────────
echo "[2/6] Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  echo "Docker already installed"
fi

if ! docker compose version &>/dev/null; then
  apt-get install -y -qq docker-compose-plugin
fi

# ─── Install git ─────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  apt-get install -y -qq git
fi

# ─── Create deploy user ─────────────────────────────────────────
echo "[3/6] Creating deploy user..."
if ! id -u deploy &>/dev/null 2>&1; then
  useradd -m -s /bin/bash -G docker deploy
  mkdir -p /home/deploy/.ssh
  chmod 700 /home/deploy/.ssh
  # Copy root's authorized keys to deploy user if they exist
  if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  fi
  chown -R deploy:deploy /home/deploy/.ssh
  chmod 600 /home/deploy/.ssh/authorized_keys 2>/dev/null || true
  echo "Created user 'deploy' with Docker access"
else
  echo "User 'deploy' already exists"
  usermod -aG docker deploy
fi

# ─── Clone repository ───────────────────────────────────────────
echo "[4/6] Cloning repository..."
if [ ! -d "$DEPLOY_DIR" ]; then
  git clone "$REPO_URL" "$DEPLOY_DIR"
  chown -R deploy:deploy "$DEPLOY_DIR"
else
  echo "Repository already exists at $DEPLOY_DIR"
  cd "$DEPLOY_DIR"
  git pull origin main || true
fi

# ─── Firewall ───────────────────────────────────────────────────
echo "[5/6] Configuring firewall..."
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp     # SSH
  ufw allow 80/tcp     # HTTP (Caddy ACME + redirect)
  ufw allow 443/tcp    # HTTPS (Caddy → API)
  ufw allow 25/tcp     # SMTP inbound
  ufw allow 587/tcp    # SMTP submission
  ufw --force enable
  echo "Firewall configured"
else
  echo "ufw not found — configure your firewall manually"
fi

# ─── Create env template ────────────────────────────────────────
echo "[6/6] Setting up configuration..."
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
  echo "Created .env from template — you MUST edit it"
else
  echo ".env already exists"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo ""
echo "1. Edit your environment variables:"
echo "   nano $DEPLOY_DIR/.env"
echo ""
echo "2. Update the Caddyfile with your domain:"
echo "   nano $DEPLOY_DIR/Caddyfile"
echo ""
echo "3. Generate DKIM keys:"
echo "   cd $DEPLOY_DIR"
echo "   docker run --rm -v \$(pwd):/app -w /app node:20-alpine node packages/api/scripts/generate-dkim.js"
echo "   # Copy the private key into .env (DKIM_PRIVATE_KEY)"
echo "   # Add the DNS TXT record shown in the output"
echo ""
echo "4. Add DNS records:"
echo "   MX     oxy.so           → 10 mail.oxy.so."
echo "   A      mail.oxy.so      → $(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP')"
echo "   A      api.oxy.so       → $(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP')"
echo "   TXT    oxy.so           → v=spf1 ip4:$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP') -all"
echo "   TXT    default._domainkey.oxy.so → (from DKIM generation)"
echo "   TXT    _dmarc.oxy.so    → v=DMARC1; p=reject; rua=mailto:dmarc@oxy.so"
echo ""
echo "5. Rename this droplet to 'mail.oxy.so' in the DO dashboard (sets PTR/rDNS)"
echo ""
echo "6. Request port 25 unblock from DigitalOcean:"
echo "   https://cloud.digitalocean.com/support"
echo ""
echo "7. Create a DigitalOcean Space called 'oxy-email' for email attachments"
echo ""
echo "8. Start everything:"
echo "   cd $DEPLOY_DIR && docker compose up -d"
echo ""
echo "9. Check logs:"
echo "   docker compose logs -f"
echo ""
echo "10. Set up auto-deploy — add these GitHub Secrets:"
echo "    DROPLET_HOST    = $(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP')"
echo "    DROPLET_USER    = deploy"
echo "    DROPLET_SSH_KEY = (generate with: ssh-keygen -t ed25519 -f deploy_key)"
echo ""
echo "    Then add the public key to the deploy user:"
echo "    echo 'CONTENTS_OF_deploy_key.pub' >> /home/deploy/.ssh/authorized_keys"
echo ""
