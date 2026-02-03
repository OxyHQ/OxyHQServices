#!/usr/bin/env bash
##
## One-time setup script for the Oxy Email Worker Droplet
##
## Run this on a fresh DigitalOcean Droplet (Ubuntu 22.04+ recommended).
## After running, configure .env.email and DNS records.
##
## Usage:
##   ssh root@your-droplet-ip
##   curl -sL https://raw.githubusercontent.com/OxyHQ/OxyHQServices/main/scripts/setup-email-droplet.sh | bash
##   # Or copy this script and run it manually
##

set -euo pipefail

echo "=== Oxy Email Worker — Droplet Setup ==="
echo ""

# ─── System updates ──────────────────────────────────────────────
echo "[1/7] Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# ─── Install Docker ──────────────────────────────────────────────
echo "[2/7] Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  echo "Docker already installed"
fi

# Install Docker Compose plugin (if not included)
if ! docker compose version &>/dev/null; then
  apt-get install -y -qq docker-compose-plugin
fi

# ─── Install Certbot for TLS ────────────────────────────────────
echo "[3/7] Installing Certbot..."
if ! command -v certbot &>/dev/null; then
  apt-get install -y -qq certbot
else
  echo "Certbot already installed"
fi

# ─── Create deploy user ─────────────────────────────────────────
echo "[4/7] Creating deploy user..."
if ! id -u deploy &>/dev/null 2>&1; then
  useradd -m -s /bin/bash -G docker deploy
  echo "Created user 'deploy' with Docker access"
  echo ""
  echo ">> Set up SSH key for the deploy user:"
  echo "   mkdir -p /home/deploy/.ssh"
  echo "   echo 'YOUR_PUBLIC_KEY' >> /home/deploy/.ssh/authorized_keys"
  echo "   chown -R deploy:deploy /home/deploy/.ssh"
  echo "   chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys"
  echo ""
else
  echo "User 'deploy' already exists"
  # Ensure deploy user is in docker group
  usermod -aG docker deploy
fi

# ─── Clone repository ───────────────────────────────────────────
echo "[5/7] Setting up repository..."
REPO_DIR="/opt/oxy-email"
if [ ! -d "$REPO_DIR" ]; then
  git clone https://github.com/OxyHQ/OxyHQServices.git "$REPO_DIR"
  chown -R deploy:deploy "$REPO_DIR"
else
  echo "Repository already cloned at $REPO_DIR"
fi

# ─── Firewall ───────────────────────────────────────────────────
echo "[6/7] Configuring firewall..."
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp    # SSH
  ufw allow 25/tcp    # SMTP inbound
  ufw allow 587/tcp   # SMTP submission
  ufw allow 993/tcp   # IMAPS (future)
  ufw allow 80/tcp    # Certbot HTTP challenge
  ufw allow 443/tcp   # HTTPS (future web admin)
  ufw --force enable
  echo "Firewall configured"
else
  echo "ufw not found, configure your firewall manually"
fi

# ─── TLS certificate ────────────────────────────────────────────
echo "[7/7] TLS certificate setup..."
echo ""
echo ">> Run certbot to get TLS certificates for your mail domain:"
echo "   certbot certonly --standalone -d mail.oxy.so"
echo ""
echo ">> Then mount the certs into the Docker container by adding to docker-compose.email.yml:"
echo "   volumes:"
echo "     - /etc/letsencrypt/live/mail.oxy.so:/certs:ro"
echo ""
echo ">> Set up auto-renewal:"
echo "   echo '0 3 * * * certbot renew --quiet && docker restart oxy-email-worker' | crontab -"
echo ""

echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo ""
echo "1. Copy .env.email.example to $REPO_DIR/.env.email and fill in your values:"
echo "   cp $REPO_DIR/.env.email.example $REPO_DIR/.env.email"
echo "   nano $REPO_DIR/.env.email"
echo ""
echo "2. Generate DKIM keys:"
echo "   cd $REPO_DIR && docker run --rm -v \$(pwd):/app -w /app node:20-alpine node packages/api/scripts/generate-dkim.js"
echo ""
echo "3. Add DNS records (MX, SPF, DKIM, DMARC, PTR)"
echo "   See: docs/EMAIL.md"
echo ""
echo "4. Get TLS certificate:"
echo "   certbot certonly --standalone -d mail.oxy.so"
echo ""
echo "5. Start the email worker:"
echo "   cd $REPO_DIR && docker compose -f docker-compose.email.yml up -d"
echo ""
echo "6. Add GitHub Secrets for auto-deploy:"
echo "   EMAIL_DROPLET_HOST = $(curl -s ifconfig.me)"
echo "   EMAIL_DROPLET_USER = deploy"
echo "   EMAIL_DROPLET_SSH_KEY = (your deploy user's private key)"
echo ""
echo "7. Request DigitalOcean to unblock port 25 (support ticket)"
echo "   https://cloud.digitalocean.com/support"
echo ""
echo "8. Rename this droplet to 'mail.oxy.so' in the DO dashboard (sets PTR/rDNS automatically)"
echo ""
