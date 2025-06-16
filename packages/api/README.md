# Oxy API

A Node.js/TypeScript authentication server providing JWT-based auth, session management, and user operations.

## Features

- 🔐 **JWT Authentication** - Secure token-based auth with automatic refresh
- 📱 **Session Management** - Device-based session isolation
- 🗄️ **MongoDB Integration** - Scalable data persistence
- ⚡ **Express.js Server** - RESTful API with middleware
- 🔒 **Security Features** - Rate limiting, CORS, password hashing
- 📝 **TypeScript** - Full type safety and developer experience

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secrets

# Start development server
npm run dev
```

## Documentation

**[📚 Complete Documentation](./docs/)**

### Quick Links
- **[🚀 Quick Start Guide](./docs/quick-start.md)** - Get running in 5 minutes
- **[⚙️ Installation & Setup](./docs/installation.md)** - Complete setup guide
- **[🔐 Authentication System](./docs/authentication.md)** - JWT auth details
- **[📖 API Reference](./docs/api-reference.md)** - Complete endpoint docs
- **[🔧 Examples](./docs/examples/)** - Integration examples

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Apps   │    │    Oxy API      │    │    MongoDB      │
│                 │    │                 │    │                 │
│ Frontend/Backend│◄──►│ Express Server  │◄──►│   Database      │
│ with OxyServices│    │ + Auth Routes   │    │ + Collections   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Register new user |
| `/api/auth/login` | POST | Login with credentials |
| `/api/auth/refresh` | POST | Refresh access token |
| `/api/auth/logout` | POST | Logout user |
| `/api/users/me` | GET | Get current user |
| `/api/sessions` | GET | List user sessions |

## Requirements

- Node.js 16+
- MongoDB 4.4+
- npm or yarn

## Environment Variables

```env
MONGODB_URI=mongodb://localhost:27017/oxyapi
ACCESS_TOKEN_SECRET=your_64_char_secret_here
REFRESH_TOKEN_SECRET=your_64_char_secret_here
PORT=3001
```

## Development

```bash
# Development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## Integration

This API works with:
- **[OxyHQServices](../OxyHQServices/)** - TypeScript client library
- **Express.js** applications via middleware
- **React/React Native** frontends
- Any HTTP client or REST API consumer

For detailed integration examples, see the **[examples directory](./docs/examples/)**.

## Monitoring

Health check endpoint:
```bash
curl http://localhost:3001/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-06-13T10:00:00.000Z",
  "services": {
    "database": true,
    "auth": true
  }
}
```

## Integration

Use with [OxyHQServices](../OxyHQServices/) client library:

```javascript
const { OxyServices } = require('@oxyhq/services/core');

const oxyServices = new OxyServices({
  baseURL: 'http://localhost:3001'
});

// Your app integration code...
```

## Documentation

- **[Complete Documentation](../docs/)** - Full system documentation
- **[API Reference](../docs/api-reference.md)** - Detailed endpoint documentation
- **[Authentication Guide](../docs/authentication.md)** - Auth system overview
- **[Troubleshooting](../docs/troubleshooting.md)** - Common issues and solutions

## License

This project is part of the OxyServices ecosystem.