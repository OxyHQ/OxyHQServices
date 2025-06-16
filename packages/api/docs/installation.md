# Installation & Setup

Complete setup guide for the Oxy API server.

## System Requirements

- **Node.js** 16.x or higher
- **MongoDB** 4.4 or higher
- **npm** or **yarn** package manager
- **Git** for version control

## MongoDB Setup

### Option 1: Local MongoDB

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install mongodb

# macOS with Homebrew
brew tap mongodb/brew
brew install mongodb-community

# Start MongoDB service
sudo systemctl start mongodb  # Linux
brew services start mongodb/brew/mongodb-community  # macOS
```

### Option 2: MongoDB Atlas (Cloud)

1. Create account at [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a new cluster
3. Get connection string: `mongodb+srv://username:password@cluster.mongodb.net/oxyapi`

### Option 3: Docker

```bash
# Run MongoDB in Docker
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -e MONGO_INITDB_DATABASE=oxyapi \
  mongo:latest
```

## Project Setup

### 1. Install Dependencies

```bash
# Navigate to oxy-api directory
cd oxy-api

# Install all dependencies
npm install

# Or with yarn
yarn install
```

### 2. Environment Configuration

Create `.env` file:

```bash
cp .env.example .env
```

Configure environment variables:

```env
# Database Configuration
MONGODB_URI=mongodb://localhost:27017/oxyapi

# JWT Token Secrets (REQUIRED - Generate secure random strings)
ACCESS_TOKEN_SECRET=your_super_secure_access_token_secret_minimum_32_chars
REFRESH_TOKEN_SECRET=your_super_secure_refresh_token_secret_minimum_32_chars

# Server Configuration
PORT=3001
NODE_ENV=development
HOST=localhost

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:4000,http://localhost:8081

# Security & Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100  # Max requests per window

# Session Configuration
SESSION_TIMEOUT_HOURS=24     # How long sessions remain active
MAX_SESSIONS_PER_USER=10     # Max concurrent sessions per user

# Logging
LOG_LEVEL=info               # error, warn, info, debug
```

### 3. Generate Secure JWT Secrets

**Critical:** Never use default or weak secrets in production.

```bash
# Generate ACCESS_TOKEN_SECRET
node -e "console.log('ACCESS_TOKEN_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"

# Generate REFRESH_TOKEN_SECRET  
node -e "console.log('REFRESH_TOKEN_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"

# Copy the output to your .env file
```

### 4. Database Initialization

The database will be automatically initialized when you start the server for the first time. Collections will be created as needed.

## Development Setup

### Start Development Server

```bash
# Development mode with hot reload
npm run dev

# Or with yarn
yarn dev
```

The server will start with:
- **API Server:** http://localhost:3001
- **API Documentation:** http://localhost:3001/api-docs (if Swagger is enabled)
- **Health Check:** http://localhost:3001/health

### Available Scripts

```bash
# Development
npm run dev          # Start with hot reload
npm run dev:debug    # Start with debugger

# Production
npm run build        # Compile TypeScript
npm start           # Start production server

# Testing & Quality
npm test            # Run test suite
npm run test:watch  # Run tests in watch mode
npm run lint        # Lint code
npm run lint:fix    # Fix linting issues

# Database
npm run db:seed     # Seed database with sample data
npm run db:reset    # Reset database (development only)
```

## Production Setup

### Environment Configuration

```env
# Production Environment
NODE_ENV=production
PORT=3001

# Database (use connection pooling for production)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/oxyapi?retryWrites=true&w=majority

# Security (use strong, unique secrets)
ACCESS_TOKEN_SECRET=your_production_access_secret_64_chars_minimum
REFRESH_TOKEN_SECRET=your_production_refresh_secret_64_chars_minimum

# CORS (specify exact origins)
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Rate Limiting (adjust based on your needs)
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=warn
```

### Build for Production

```bash
# Install dependencies
npm ci --only=production

# Build the application
npm run build

# Start production server
npm start
```

### Process Management

Use a process manager for production:

#### PM2 (Recommended)

```bash
# Install PM2 globally
npm install -g pm2

# Start application
pm2 start dist/server.js --name "oxy-api"

# Monitor
pm2 monitor

# Setup auto-restart on system reboot
pm2 startup
pm2 save
```

#### Docker

```dockerfile
# Dockerfile
FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

EXPOSE 3001

USER node

CMD ["npm", "start"]
```

```bash
# Build and run
docker build -t oxy-api .
docker run -d -p 3001:3001 --env-file .env oxy-api
```

## Verification

### Health Check

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-06-13T10:30:00.000Z",
  "version": "1.0.0",
  "database": "connected"
}
```

### Authentication Test

```bash
# Register test user
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@example.com","password":"password123"}'

# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"password123"}'
```

## Troubleshooting

### Common Issues

**MongoDB Connection Failed:**
```bash
# Check MongoDB status
sudo systemctl status mongodb  # Linux
brew services list | grep mongodb  # macOS

# Test connection
mongo mongodb://localhost:27017/oxyapi
```

**Port Already in Use:**
```bash
# Find process using port
lsof -ti:3001

# Kill process
lsof -ti:3001 | xargs kill
```

**JWT Token Errors:**
- Ensure `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` are set
- Secrets must be at least 32 characters long
- Restart server after changing secrets

**CORS Errors:**
- Add your frontend domain to `ALLOWED_ORIGINS`
- Use exact URLs (including protocol and port)
- Restart server after changes

### Log Files

Development logs are printed to console. For production:

```bash
# PM2 logs
pm2 logs oxy-api

# Docker logs
docker logs <container_id>
```

## Next Steps

- **[Authentication Guide](./authentication.md)** - Understanding the auth system
- **[API Reference](./api-reference.md)** - Complete endpoint documentation
- **[Security Guide](./security.md)** - Production security best practices
- **[Examples](./examples/)** - Integration examples
