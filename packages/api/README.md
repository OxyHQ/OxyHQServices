# Oxy API

A comprehensive Node.js/TypeScript backend server providing JWT-based authentication, device-first session management, user management, file storage, real-time notifications, payment processing, and social features.

## Features

- 🔐 **JWT Authentication** - Secure token-based auth with automatic refresh
- 📱 **Device Sessions** - One server-side `DeviceSession` per device (signed-in accounts, active account, revision) with instant cross-app socket sync
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
- **[📱 Device Sessions](../../docs/auth/device-session.md)** - DeviceSession API, socket events, multi-account
- **[🤝 Third-party Integration](../../docs/auth/integration-guide.md)** - Sign in with Oxy (OAuth 2.0 + PKCE)
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

Routes are mounted without a prefix (e.g. `POST /auth/login`). A leading `/api/` prefix is also accepted and stripped by the server.

### Authentication
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/register` | POST | Register new public-key identity |
| `/auth/signup` | POST | Password sign-up (email + username + password) |
| `/auth/login` | POST | Password login (email/username + password) |
| `/auth/challenge` | POST | Request public-key challenge |
| `/auth/verify` | POST | Verify signed challenge |
| `/auth/refresh-token` | POST | Rotate the refresh-token family, mint a new access token |
| `/auth/logout` | POST | Logout user |
| `/auth/validate` | GET | Validate current token |
| `/auth/recover/request` | POST | Request account recovery code |
| `/auth/recover/verify` | POST | Verify recovery code |
| `/auth/recover/reset` | POST | Reset password with verified code |
| `/auth/service-token` | POST | Exchange a `service` ApplicationCredential (publicKey + secret) for a 1h service JWT |

### Device sessions (server session authority)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/device/bootstrap` | GET | Issue a single-use, origin-bound boot code (returned via `#oxy_boot` fragment) |
| `/auth/device/exchange` | POST | Redeem a boot code for tokens on a sibling origin |
| `/session/device/state` | GET | Current `DeviceSession` state (accounts, active account, revision) — token-free |
| `/session/device/add` | POST | Add the bearer's account to the device session |
| `/session/device/switch` | POST | Switch the active account (`revision++`, socket broadcast) |
| `/session/device/signout` | POST | Remove one account or all accounts from the device |

Every device-session mutation broadcasts a `session_state` event to the Socket.IO room `device:<deviceId>` so all apps on the same device sync instantly. See [device sessions](../../docs/auth/device-session.md).

### OAuth 2.0 (third-party "Sign in with Oxy")
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/oauth/client/:clientId` | GET | Public Application metadata (name, logo, type, legal URLs) |
| `/auth/oauth/consent` | GET | Whether the current user must see the consent screen |
| `/auth/oauth/authorize` | POST | Mint a single-use authorization code (IdP-side, Bearer) |
| `/auth/oauth/token` | POST | Exchange code (+ PKCE verifier or client secret) for tokens |
| `/auth/grants` | GET/DELETE | List / revoke the user's connected-app grants |

### Two-Factor (TOTP)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/security/2fa/setup` | POST | Start TOTP enrollment |
| `/security/2fa/enable` | POST | Verify enrollment code and enable |
| `/security/2fa/verify-login` | POST | Verify TOTP after password login |
| `/security/2fa/disable` | POST | Disable TOTP (code required) |

### User Management
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/users/me` | GET | Get current user |
| `/users/me` | PUT | Update current user |
| `/session/*` | Various | Per-session management (validate, logout one/all) |

### File Management (assets)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/assets/upload` | POST | Upload file |
| `/assets/init` + `/assets/complete` | POST | Chunked/multipart upload handshake |
| `/assets/batch-access` | POST | Batch access checks / signed URLs |
| `/storage/usage` | GET | Account storage usage |

### Profiles & Social
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/profiles/username/:username` | GET | Get profile by username |
| `/profiles/search` | GET | Search profiles |
| `/profiles/recommendations` | GET | Get recommended profiles |

### Notifications
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/notifications` | GET | Get user notifications |
| `/notifications/unread-count` | GET | Get unread count |
| `/notifications/:id/read` | PUT | Mark as read |
| `/notifications/read-all` | PUT | Mark all as read |

### Payments & Wallet
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/payments/user` | GET | Get transaction history for current user |
| `/billing/checkout/credits` | POST | Start credits checkout (Stripe) |
| `/billing/checkout/subscription` | POST | Start subscription checkout (Stripe) |
| `/billing/portal` | POST | Open Stripe Customer Portal |
| `/wallet/:userId` | GET | Get wallet info |
| `/wallet/transactions/:userId` | GET | Get transaction history |
| `/wallet/transfer` | POST | Transfer funds |
| `/wallet/purchase` | POST | Process purchase |
| `/wallet/withdraw` | POST | Request withdrawal |

### Analytics (Premium)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/analytics` | GET | Get analytics data |
| `/analytics/update` | POST | Update analytics |
| `/analytics/viewers` | GET | Get content viewers |
| `/analytics/followers` | GET | Get follower details |

### Privacy & Search
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/privacy/*` | Various | Privacy settings |
| `/search` | GET | Search functionality |

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

# MFA
MFA_TOKEN_SECRET=replace_me
MFA_TOKEN_TTL_SECONDS=300
TOTP_ISSUER=Oxy
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

// Device-session sync: the server joins the socket to `device:<deviceId>`
// (derived from the JWT claim — never client-supplied) and pushes the
// token-free DeviceSession state on every mutation.
socket.on('session_state', (state) => {
  console.log('Device session updated:', state.revision);
});
```

## Integration

This API works with:
- **[@oxyhq/core](../core/)** - TypeScript client library (`OxyServices`, `SessionClient`)
- **[@oxyhq/services](../services/)** - Expo / React Native / web UI SDK (`OxyProvider`)
- **Express.js** applications via `@oxyhq/core/server` middleware
- Any HTTP client or REST API consumer

For detailed integration examples, see the **[examples directory](./docs/examples/)**.

## Monitoring

Health check endpoint:
```bash
curl http://localhost:3001/health
```

## Storage Usage

The API exposes an authenticated endpoint to retrieve **account storage usage** aggregated from the Central Asset Service:

- `GET /storage/usage`: returns total used bytes, plan limit bytes, and a category breakdown.

Response:
```json
{
  "usedBytes": 104857600,
  "limitBytes": 5368709120,
  "categories": {
    "files": 83886080,
    "avatars": 20971520
  }
}
```

## Security Features

- **Rate Limiting**: Configurable rate limits per endpoint (every limiter has a unique `rl:<scope>:` Redis prefix)
- **Brute Force Protection**: Automatic blocking of suspicious activity
- **CORS**: Deny-by-default allowlist via `createOxyCors` (never wildcard + credentials)
- **JWT Token Security**: Secure token generation and validation
- **File Upload Security**: File type validation and size limits
- **Session Isolation**: Device-based session management with server-side revocation

## Performance

- **File Streaming**: Efficient file serving via GridFS streams
- **Database Indexing**: Optimized MongoDB queries
- **Caching**: Response caching for static content
- **Connection Pooling**: Efficient database connections

## License

This project is part of the OxyServices ecosystem.
