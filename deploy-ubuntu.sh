#!/bin/bash

# =================================================================
# KChat Application - Ubuntu Server Deployment Script
# Domain: kchat.nikniksen.de
# =================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOMAIN="kchat.nikniksen.de"
APP_NAME="kchat"
APP_USER="ubuntu"
APP_DIR="/home/ubuntu/$APP_NAME"
REPO_URL="https://github.com/nikthecrick/kchat2.git"
NODE_VERSION="22"
EMAIL="nikniksen@proton.me"

echo -e "${BLUE}🚀 KChat Deployment for $DOMAIN${NC}"
echo -e "${BLUE}============================================${NC}"

# Function to print status
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# =================================================================
# 1. SYSTEM UPDATE
# =================================================================
print_status "Step 1: Updating system packages..."
sudo apt update && sudo apt upgrade -y

# =================================================================
# 2. INSTALL REQUIRED SOFTWARE
# =================================================================
print_status "Step 2: Installing required software..."

# Install Node.js
if ! command_exists node; then
    print_status "Installing Node.js $NODE_VERSION..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    print_status "Node.js already installed: $(node --version)"
fi

# Install npm
if ! command_exists npm; then
    print_status "Installing npm..."
    sudo apt-get install -y npm
else
    print_status "npm already installed: $(npm --version)"
fi

# Install nginx
if ! command_exists nginx; then
    print_status "Installing nginx..."
    sudo apt-get install -y nginx
else
    print_status "nginx already installed: $(nginx -v)"
fi

# Install certbot for SSL
if ! command_exists certbot; then
    print_status "Installing certbot..."
    sudo apt-get install -y certbot python3-certbot-nginx
else
    print_status "certbot already installed"
fi

# Install git
if ! command_exists git; then
    print_status "Installing git..."
    sudo apt-get install -y git
else
    print_status "git already installed: $(git --version)"
fi

# Install PM2 for process management
if ! command_exists pm2; then
    print_status "Installing PM2..."
    sudo npm install -g pm2
else
    print_status "PM2 already installed: $(pm2 --version)"
fi

# =================================================================
# 3. VERIFY APPLICATION USER
# =================================================================
print_status "Step 3: Verifying application user..."

if ! id "$APP_USER" &>/dev/null; then
    print_error "User $APP_USER does not exist. This script assumes Ubuntu user exists."
    exit 1
else
    print_status "User $APP_USER exists"
fi

# =================================================================
# 4. CLONE REPOSITORY
# =================================================================
print_status "Step 4: Cloning application repository..."

if [ -d "$APP_DIR" ]; then
    print_warning "Directory $APP_DIR already exists, removing..."
    sudo rm -rf $APP_DIR
fi

git clone $REPO_URL $APP_DIR
cd $APP_DIR

# =================================================================
# 5. INSTALL DEPENDENCIES
# =================================================================
print_status "Step 5: Installing application dependencies..."

npm install

# =================================================================
# 5.5. SETUP ENVIRONMENT FIRST (needed for database)
# =================================================================
print_status "Step 5.5: Setting up environment configuration first..."

# Generate secure JWT secret
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")

# Create .env file with ABSOLUTE database path
tee $APP_DIR/.env > /dev/null <<EOF
DATABASE_URL=file:/home/ubuntu/kchat/db/custom.db

# WebAuthn/Passkey Configuration
RP_ID=$DOMAIN
ORIGIN=https://$DOMAIN

# JWT Secret for session management
JWT_SECRET=$JWT_SECRET

# Production settings
NODE_ENV=production
PORT=3000
EOF

print_status "Environment configured for $DOMAIN"
print_status "Generated secure JWT secret: ${JWT_SECRET:0:8}..."

# =================================================================
# 6. SETUP DATABASE
# =================================================================
print_status "Step 6: Setting up database..."

# Create db directory
mkdir -p $APP_DIR/db

# Generate Prisma client
npx prisma generate

# Push database schema
npx prisma db push

print_status "Database initialized successfully"

# =================================================================
# 7. BUILD APPLICATION
# =================================================================
print_status "Step 7: Building application..."

npm run build

# =================================================================
# 7.5. COPY DATABASE TO STANDALONE
# =================================================================
print_status "Step 7.5: Copying database to standalone build..."

# Ensure database directory exists in standalone (though we use absolute path in env, good practice)
mkdir -p $APP_DIR/.next/standalone/db

# Copy .env to standalone directory (server.js might try to load it)
cp $APP_DIR/.env $APP_DIR/.next/standalone/.env

# We do NOT copy the database file itself to standalone/db anymore because we are using
# the absolute path to the main db file in $APP_DIR/db/custom.db.
# This prevents split-brain database issues where the app writes to the standalone copy
# but we back up or inspect the main copy.

print_status "Environment configured for standalone build"

# =================================================================
# 8. SETUP NGINX CONFIGURATION
# =================================================================
print_status "Step 8: Configuring nginx for HTTP (pre-SSL)..."

# Create basic HTTP nginx config for certbot to work with
sudo tee /etc/nginx/sites-available/$DOMAIN > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    # Handle Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Proxy to Next.js app
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket support for Socket.io
    location /api/socket/io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Create certbot directory
sudo mkdir -p /var/www/certbot

# Test and reload nginx
sudo nginx -t && sudo systemctl reload nginx

print_status "nginx HTTP configuration created and enabled for $DOMAIN"

# =================================================================
# 9. SETUP PM2 CONFIGURATION
# =================================================================
print_status "Step 9: Setting up PM2 process management..."

# Create PM2 ecosystem file with correct standalone paths
# NOTE: We use absolute path for DATABASE_URL to avoid CWD ambiguity in standalone mode
tee $APP_DIR/ecosystem.config.json > /dev/null <<EOF
{
  "apps": [
    {
      "name": "$APP_NAME",
      "script": "server.js",
      "cwd": "$APP_DIR/.next/standalone",
      "instances": 1,
      "exec_mode": "fork",
      "watch": false,
      "max_memory_restart": "1G",
      "env": {
        "NODE_ENV": "production",
        "PORT": 3000,
        "RP_ID": "$DOMAIN",
        "ORIGIN": "https://$DOMAIN",
        "JWT_SECRET": "$JWT_SECRET",
        "DATABASE_URL": "file:$APP_DIR/db/custom.db"
      },
      "log_file": "$APP_DIR/logs/combined.log",
      "out_file": "$APP_DIR/logs/out.log",
      "error_file": "$APP_DIR/logs/error.log",
      "log_date_format": "YYYY-MM-DD HH:mm Z",
      "merge_logs": true,
      "max_restarts": 10,
      "min_uptime": "10s"
    }
  ]
}
EOF

# Create logs directory with proper permissions
mkdir -p $APP_DIR/logs 2>/dev/null || print_warning "Could not create logs directory, but continuing..."

# =================================================================
# 10. SETUP SSL CERTIFICATES
# =================================================================
print_status "Step 10: Setting up SSL certificates..."

print_status "Running certbot to obtain SSL certificate..."
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email $EMAIL --redirect

# Check if certificates were obtained successfully
print_status "Verifying SSL certificate files..."
if sudo test -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" && sudo test -f "/etc/letsencrypt/live/$DOMAIN/privkey.pem"; then
    print_status "SSL certificates obtained successfully!"
    print_status "nginx has been automatically configured with SSL"
    
    # Verify nginx config is working
    if sudo nginx -t; then
        print_status "nginx configuration is valid"
        sudo systemctl reload nginx
        print_status "nginx reloaded successfully"
    else
        print_error "nginx configuration test failed"
        exit 1
    fi
else
    print_error "SSL certificate setup failed. Please run manually:"
    echo -e "${YELLOW}sudo certbot --nginx -d $DOMAIN${NC}"
    exit 1
fi

# =================================================================
# 11. START APPLICATION
# =================================================================
print_status "Step 11: Starting application with PM2..."

# Start application with PM2
pm2 start $APP_DIR/ecosystem.config.json

# Save PM2 process list
pm2 save

# =================================================================
# 12. SETUP FIREWALL
# =================================================================
print_status "Step 12: Configuring firewall..."

# Allow HTTP, HTTPS, and SSH
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp

# Enable firewall
sudo ufw --force enable

print_status "Firewall configured"

# =================================================================
# 13. CREATE HELPER SCRIPTS
# =================================================================
print_status "Step 13: Creating helper scripts..."

# Create restart script
sudo tee /usr/local/bin/restart-kchat > /dev/null <<EOF
#!/bin/bash
echo "Restarting KChat Application..."
sudo -u ubuntu pm2 restart $APP_NAME
echo "KChat restarted!"
EOF

sudo chmod +x /usr/local/bin/restart-kchat

# Create logs script
sudo tee /usr/local/bin/kchat-logs > /dev/null <<EOF
#!/bin/bash
sudo -u ubuntu pm2 logs $APP_NAME --lines 100
EOF

sudo chmod +x /usr/local/bin/kchat-logs

# =================================================================
# DEPLOYMENT COMPLETE
# =================================================================
print_status "Deployment complete!"
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}🎉 KChat Application Deployed Successfully!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${BLUE}Application Details:${NC}"
echo -e "Domain: ${BLUE}https://$DOMAIN${NC}"
echo -e "User: ${BLUE}ubuntu${NC}"
echo -e "Directory: ${BLUE}$APP_DIR${NC}"
echo -e "Process Manager: ${BLUE}PM2${NC}"
echo ""
echo -e "${BLUE}Useful Commands:${NC}"
echo -e "Restart app: ${YELLOW}restart-kchat${NC}"
echo -e "View logs: ${YELLOW}kchat-logs${NC}"
echo -e "PM2 status: ${YELLOW}sudo -u ubuntu pm2 status${NC}"
echo -e "PM2 list: ${YELLOW}sudo -u ubuntu pm2 list${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Run: sudo certbot --nginx -d $DOMAIN"
echo "2. Test: https://$DOMAIN"
echo "3. Create admin account and test functionality"
echo ""
echo -e "${GREEN}Deployment script completed successfully!${NC}"