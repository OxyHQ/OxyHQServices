# Quick Start Guide

Get the Oxy API server running in under 5 minutes.

## Prerequisites

- Node.js 16+
- MongoDB running locally or remote URI
- npm or yarn

## Step 1: Clone & Install

```bash
# Navigate to oxy-api directory
cd oxy-api

# Install dependencies
npm install
```

## Step 2: Configure Environment

```bash
# Copy example environment file
cp .env.example .env
```

Edit `.env` file:

```env
# Database
MONGODB_URI=mongodb://localhost:27017/oxyapi

# JWT Secrets (generate secure random strings)
ACCESS_TOKEN_SECRET=your_super_secure_access_token_secret_here
REFRESH_TOKEN_SECRET=your_super_secure_refresh_token_secret_here

# Server
PORT=3001
NODE_ENV=development

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:4000,http://localhost:8081
```

### Generate JWT Secrets

```bash
# Generate secure random secrets
node -e "console.log('ACCESS_TOKEN_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('REFRESH_TOKEN_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
```

## Step 3: Start the Server

```bash
# Development mode (with hot reload)
npm run dev

# The server will start on http://localhost:3001
```

You should see:
```
🚀 Server running on port 3001
📚 API docs available at http://localhost:3001/api-docs
✅ MongoDB connected successfully
```

## Step 4: Test the API

### Register a New User

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "password123"
  }'
```

### Login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "password123"
  }'
```

### Test Protected Route

```bash
# Replace YOUR_ACCESS_TOKEN with the token from login response
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  http://localhost:3001/api/users/me
```

## Next Steps

- **[Installation Guide](./installation.md)** - Complete setup instructions
- **[Authentication](./authentication.md)** - Understanding the auth flow
- **[API Reference](./api-reference.md)** - All available endpoints
- **[Examples](./examples/)** - Integration examples

## Troubleshooting

### Common Issues

**MongoDB Connection Error:**
- Ensure MongoDB is running
- Check `MONGODB_URI` in `.env`
- Verify MongoDB credentials if using authentication

**Port Already in Use:**
- Change `PORT` in `.env` to an available port
- Or stop the process using port 3001: `lsof -ti:3001 | xargs kill`

**CORS Errors:**
- Add your frontend URL to `ALLOWED_ORIGINS` in `.env`
- Restart the server after environment changes

For more help, see the [troubleshooting guide](./troubleshooting.md).
