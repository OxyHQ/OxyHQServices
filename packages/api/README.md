# Oxy API

A comprehensive Node.js/TypeScript backend server providing JWT-based authentication, user management, file storage, real-time notifications, payment processing, and social features.

## Features

- 🔐 **JWT Authentication** - Secure token-based auth with automatic refresh
- 📱 **Session Management** - Device-based session isolation with secure session handling
- 🗄️ **MongoDB Integration** - Scalable data persistence with GridFS for file storage
- ⚡ **Express.js Server** - RESTful API with comprehensive middleware
- 🔒 **Security Features** - Rate limiting, CORS, password hashing, brute force protection
- 📝 **TypeScript** - Full type safety and developer experience
- 📁 **File Management** - GridFS-based file upload, storage, and streaming
- 👥 **Social Features** - User profiles, following system, recommendations
- 🔔 **Real-time Notifications** - Socket.IO powered notifications
- 💳 **Payment Processing** - Payment method validation and processing
- 💰 **Wallet System** - Digital wallet with transaction history
- 📊 **Analytics** - Premium analytics and insights
- 🔒 **Privacy Controls** - User privacy settings and data management
- 🔍 **Search** - Advanced user and content search capabilities

## Quick Start

```bash
# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your MongoDB URI, JWT secrets, and other configs

# Start development server
bun run dev
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
│                 │    │ + File Storage  │    │ + GridFS        │
│                 │    │ + Socket.IO     │    │ + Analytics     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## API Endpoints

### Authentication
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Register new public-key identity |
| `/api/auth/signup` | POST | Password sign-up (email + username + password) |
| `/api/auth/login` | POST | Password login (email/username + password) |
| `/api/auth/challenge` | POST | Request public-key challenge |
| `/api/auth/verify` | POST | Verify signed challenge |
| `/api/auth/totp/verify-login` | POST | Verify TOTP after password |
| `/api/auth/refresh` | POST | Refresh access token |
| `/api/auth/logout` | POST | Logout user |
| `/api/auth/validate` | GET | Validate current token |
| `/api/auth/recover/request` | POST | Request account recovery code |
| `/api/auth/recover/verify` | POST | Verify recovery code |
| `/api/auth/recover/reset` | POST | Reset password with verified code |

Note: All auth endpoints are also available under `/auth` (e.g., `POST /auth/login`).

### TOTP (Two-Factor)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/totp/enroll/start` | POST | Start TOTP enrollment (needs x-session-id) |
| `/api/auth/totp/enroll/verify` | POST | Verify TOTP enrollment code |
| `/api/auth/totp/disable` | POST | Disable TOTP (code required) |

### User Management
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/users/me` | GET | Get current user |
| `/api/users/me` | PUT | Update current user |
| `/api/sessions` | GET | List user sessions |

### File Management
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/files/upload-raw` | POST | Upload file (raw data) |
| `/api/files/:id` | GET | Stream/download file |
| `/api/files/meta/:id` | GET | Get file metadata |
| `/api/files/list/:userID` | GET | List user files |
| `/api/files/:id` | DELETE | Delete file |

### Profiles & Social
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/profiles/username/:username` | GET | Get profile by username |
| `/api/profiles/search` | GET | Search profiles |
| `/api/profiles/recommendations` | GET | Get recommended profiles |

### Notifications
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notifications` | GET | Get user notifications |
| `/api/notifications/unread-count` | GET | Get unread count |
| `/api/notifications/:id/read` | PUT | Mark as read |
| `/api/notifications/read-all` | PUT | Mark all as read |

### Payments & Wallet
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/payments/user` | GET | Get transaction history for current user |
| `/api/billing/checkout/credits` | POST | Start credits checkout (Stripe) |
| `/api/billing/checkout/subscription` | POST | Start subscription checkout (Stripe) |
| `/api/billing/portal` | POST | Open Stripe Customer Portal |
| `/api/wallet/:userId` | GET | Get wallet info |
| `/api/wallet/transactions/:userId` | GET | Get transaction history |
| `/api/wallet/transfer` | POST | Transfer funds |
| `/api/wallet/purchase` | POST | Process purchase |
| `/api/wallet/withdraw` | POST | Request withdrawal |

### Analytics (Premium)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analytics` | GET | Get analytics data |
| `/api/analytics/update` | POST | Update analytics |
| `/api/analytics/viewers` | GET | Get content viewers |
| `/api/analytics/followers` | GET | Get follower details |

### Privacy & Search
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/privacy/*` | Various | Privacy settings |
| `/api/search` | GET | Search functionality |

## Requirements

- Node.js 16+
- MongoDB 4.4+
- Bun

## Environment Variables

```env
# Database
MONGODB_URI=mongodb://localhost:27017/oxyapi

# Authentication
ACCESS_TOKEN_SECRET=your_64_char_secret_here
REFRESH_TOKEN_SECRET=your_64_char_secret_here

# Server
PORT=3001
NODE_ENV=development

# File Storage
MAX_FILE_SIZE=52428800  # 50MB in bytes

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100

EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey_or_username
SMTP_PASS=secret
SMTP_FROM="Oxy <no-reply@oxy.so>"
```

## Development

```bash
# Development mode with hot reload
bun run dev

# Build for production
bun run build

# Start production server
bun run start

# Clean build artifacts
bun run clean
```

## Real-time Features

The API includes Socket.IO for real-time features:

```javascript
// Connect to Socket.IO
const socket = io('http://localhost:3001', {
  auth: {
    token: 'your_jwt_token'
  }
});

// Listen for notifications
socket.on('notification', (data) => {
  console.log('New notification:', data);
});

// Listen for session updates
socket.on('session_update', (data) => {
  console.log('Session updated:', data);
});
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

## Storage Usage

The API exposes an authenticated endpoint to retrieve **account storage usage** aggregated from the Central Asset Service:

- `GET /api/storage/usage`: returns total used bytes, plan limit bytes, and a category breakdown.

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-06-13T10:00:00.000Z",
  "services": {
    "database": true,
    "auth": true,
    "fileStorage": true
  }
}
```

## Security Features

- **Rate Limiting**: Configurable rate limits per endpoint
- **Brute Force Protection**: Automatic blocking of suspicious activity
- **CORS**: Origin-reflecting CORS with credentials support
- **JWT Token Security**: Secure token generation and validation
- **File Upload Security**: File type validation and size limits
- **Session Isolation**: Device-based session management

## Performance

- **File Streaming**: Efficient file serving via GridFS streams
- **Database Indexing**: Optimized MongoDB queries
- **Caching**: Response caching for static content
- **Connection Pooling**: Efficient database connections

## Documentation

- **[Complete Documentation](./docs/)** - Full system documentation
- **[API Reference](./docs/api-reference.md)** - Detailed endpoint documentation
- **[Authentication Guide](./docs/authentication.md)** - Auth system overview
- **[File Management](./docs/file-management.md)** - File upload and storage guide
- **[Troubleshooting](./docs/troubleshooting.md)** - Common issues and solutions

## License

This project is part of the OxyServices ecosystem.
# MFA
MFA_TOKEN_SECRET=replace_me
MFA_TOKEN_TTL_SECONDS=300
TOTP_ISSUER=Oxy
