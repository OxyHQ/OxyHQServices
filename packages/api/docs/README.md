# Oxy API Documentation

A comprehensive Node.js/TypeScript backend server providing JWT-based authentication, user management, file storage, real-time notifications, payment processing, and social features.

## 📚 Documentation

- **[Quick Start](./quick-start.md)** - Get the API running in 5 minutes
- **[Installation & Setup](./installation.md)** - Complete setup guide
- **[Authentication](./authentication.md)** - JWT auth system details
- **[API Reference](./api-reference.md)** - Complete endpoint documentation
- **[File Management](./file-management.md)** - File upload, storage, and streaming
- **[Session Management](./session-management.md)** - Device-based sessions
- **[Security](./security.md)** - Security best practices
- **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions
- **[Examples](./examples/)** - Code examples and integrations

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your MongoDB URI, JWT secrets, and other configs
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
│                 │    │ + File Storage  │    │ + GridFS        │
│                 │    │ + Socket.IO     │    │ + Analytics     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🔑 Key Features

- **JWT Authentication** - Secure token-based auth with refresh
- **Session Management** - Device-based session isolation with secure handling
- **File Management** - GridFS-based file upload, storage, and streaming
- **Social Features** - User profiles, following system, recommendations
- **Real-time Notifications** - Socket.IO powered notifications
- **Payment Processing** - Payment method validation and processing
- **Wallet System** - Digital wallet with transaction history
- **Analytics** - Premium analytics and insights
- **Privacy Controls** - User privacy settings and data management
- **Search** - Advanced user and content search capabilities
- **Multi-User Support** - Handle multiple authenticated users
- **MongoDB Integration** - Robust data persistence with GridFS
- **TypeScript** - Full type safety and developer experience
- **RESTful API** - Standard HTTP endpoints
- **CORS & Security** - Production-ready security middleware

## 📦 API Endpoints

### Authentication
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Register new user |
| `/api/auth/login` | POST | Login with credentials |
| `/api/auth/refresh` | POST | Refresh access token |
| `/api/auth/logout` | POST | Logout user |
| `/api/auth/validate` | GET | Validate token |

### User Management
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/users/me` | GET | Get current user |
| `/api/users/me` | PUT | Update user profile |
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
| `/api/payments/process` | POST | Process payment |
| `/api/payments/validate` | POST | Validate payment method |
| `/api/payments/methods/:userId` | GET | Get payment methods |
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

## 🛠️ Development

```bash
# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Clean build artifacts
npm run clean
```

## 🔧 Configuration

Key environment variables:

```env
# Database
MONGODB_URI=mongodb://localhost:27017/oxyapi

# Authentication
ACCESS_TOKEN_SECRET=your_secret_here
REFRESH_TOKEN_SECRET=your_secret_here

# Server
PORT=3001
NODE_ENV=development

# File Storage
MAX_FILE_SIZE=52428800  # 50MB in bytes

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100

# CORS (comma-separated)
ALLOWED_ORIGINS=https://mention.earth,https://homiio.com,https://api.oxy.so
```

## 📋 Requirements

- Node.js 16+
- MongoDB 4.4+
- npm or yarn

## 🔌 Real-time Features

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

## 🤝 Integration

This API is designed to work with:

- **OxyHQServices** client library
- **Express.js** applications
- **React/React Native** frontends
- Any HTTP client or REST API consumer

For client integration examples, see the [examples](./examples/) directory.

## 🔒 Security Features

- **Rate Limiting**: Configurable rate limits per endpoint
- **Brute Force Protection**: Automatic blocking of suspicious activity
- **CORS Protection**: Configurable cross-origin resource sharing
- **JWT Token Security**: Secure token generation and validation
- **File Upload Security**: File type validation and size limits
- **Session Isolation**: Device-based session management

## 📊 Performance

- **File Streaming**: Efficient file serving via GridFS streams
- **Database Indexing**: Optimized MongoDB queries
- **Caching**: Response caching for static content
- **Connection Pooling**: Efficient database connections

## 📝 Recent Changes

### User Model Simplification (v2.1.0)
- **Removed unnecessary fields** from User schema:
  - `coverPhoto`, `location`, `website`, `links` - Extended profile features
  - `labels[]` - User labeling system
  - `associated` object - Associated counts (lists, feedgens, starterPacks, labeler)
  - `pinnedPost` and `pinnedPosts` - Post pinning features
  - `_count.posts` and `_count.karma` - Post and karma counters
- **Kept essential fields**:
  - `_count.followers` and `_count.following` - Core social features
  - `privacySettings` - Complete privacy control system
  - `name`, `avatar`, `bio`, `description` - Core profile information
- **Improved user creation**:
  - Eliminated code duplication in user registration
  - All defaults now handled by Mongoose schema
  - Simplified authentication routes
  - Direct model usage instead of factory pattern

### Benefits
- **Reduced complexity**: Simpler user model focused on core features
- **Better maintainability**: Single source of truth for defaults
- **Improved performance**: Fewer fields to process and store
- **Cleaner API**: More focused user endpoints
- **Type safety**: Better TypeScript support with simplified schema
