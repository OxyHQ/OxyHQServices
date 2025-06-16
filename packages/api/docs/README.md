# Oxy API Documentation

A Node.js/TypeScript authentication server providing JWT-based auth, session management, and user operations.

## 📚 Documentation

- **[Quick Start](./quick-start.md)** - Get the API running in 5 minutes
- **[Installation & Setup](./installation.md)** - Complete setup guide
- **[Authentication](./authentication.md)** - JWT auth system details
- **[API Reference](./api-reference.md)** - Complete endpoint documentation
- **[Session Management](./session-management.md)** - Device-based sessions
- **[Security](./security.md)** - Security best practices
- **[Examples](./examples/)** - Code examples and integrations

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your MongoDB URI and JWT secrets
   ```

3. **Start the server:**
   ```bash
   npm run dev
   ```

4. **Test authentication:**
   ```bash
   curl -X POST http://localhost:3001/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"username":"test","email":"test@example.com","password":"password123"}'
   ```

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Apps   │    │    Oxy API      │    │    MongoDB      │
│                 │    │                 │    │                 │
│ Frontend/Backend│◄──►│ Express Server  │◄──►│   Database      │
│ with OxyServices│    │ + Auth Routes   │    │ + Collections   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🔑 Key Features

- **JWT Authentication** - Secure token-based auth with refresh
- **Session Management** - Device-based session isolation
- **Multi-User Support** - Handle multiple authenticated users
- **MongoDB Integration** - Robust data persistence
- **TypeScript** - Full type safety and developer experience
- **RESTful API** - Standard HTTP endpoints
- **CORS & Security** - Production-ready security middleware

## 📦 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Register new user |
| `/api/auth/login` | POST | Login with credentials |
| `/api/auth/refresh` | POST | Refresh access token |
| `/api/auth/logout` | POST | Logout user |
| `/api/auth/validate` | GET | Validate token |
| `/api/users/me` | GET | Get current user |
| `/api/users/me` | PUT | Update user profile |
| `/api/sessions` | GET | List user sessions |
| `/api/sessions/:id` | DELETE | Logout specific session |

## 🛠️ Development

```bash
# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Lint code
npm run lint
```

## 🔧 Configuration

Key environment variables:

```env
MONGODB_URI=mongodb://localhost:27017/oxyapi
ACCESS_TOKEN_SECRET=your_secret_here
REFRESH_TOKEN_SECRET=your_secret_here
PORT=3001
NODE_ENV=development
```

## 📋 Requirements

- Node.js 16+
- MongoDB 4.4+
- npm or yarn

## 🤝 Integration

This API is designed to work with:

- **OxyHQServices** client library
- **Express.js** applications
- **React/React Native** frontends
- Any HTTP client or REST API consumer

For client integration examples, see the [examples](./examples/) directory.
