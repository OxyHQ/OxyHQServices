# OxyHQ API - High Performance Backend

A modern, high-performance, and scalable API server built with Express.js, TypeScript, MongoDB, and Redis. Designed for real-time features, optimal performance, and enterprise-grade security.

## 🚀 Key Features

### ⚡ Performance Optimizations
- **Redis Caching**: Intelligent caching with graceful fallback
- **Database Optimization**: Connection pooling, indexing, and query monitoring
- **Rate Limiting**: Advanced rate limiting with different strategies per endpoint
- **Compression**: Gzip compression for all responses
- **CDN Ready**: Optimized for content delivery networks

### 🔒 Security Features
- **Helmet.js**: Comprehensive security headers
- **Input Validation**: Zod-based runtime type checking
- **Rate Limiting**: Brute force protection and progressive delays
- **CORS**: Secure cross-origin resource sharing
- **JWT Authentication**: Secure token-based authentication with refresh tokens

### 📊 Monitoring & Analytics
- **Winston Logging**: Structured logging with multiple transports
- **Performance Metrics**: Real-time request/response monitoring
- **Health Checks**: Comprehensive system health monitoring
- **Error Tracking**: Detailed error logging and tracking

### 🏗️ Architecture
- **TypeScript**: Full type safety and better developer experience
- **Modular Design**: Clean separation of concerns
- **Middleware Stack**: Optimized middleware pipeline
- **Error Handling**: Centralized error handling with custom error classes

## 🛠️ Technology Stack

- **Runtime**: Node.js 18+ with TypeScript 5+
- **Framework**: Express.js with optimized middleware stack
- **Database**: MongoDB 5+ with Mongoose ODM
- **Cache**: Redis 6+ for in-memory caching
- **Authentication**: JWT with refresh token rotation
- **Validation**: Zod for runtime type checking
- **Logging**: Winston for structured logging
- **Security**: Helmet, rate limiting, CORS
- **Real-time**: Socket.IO for WebSocket connections

## 📦 Installation

### Prerequisites
- Node.js 18+
- MongoDB 5+
- Redis 6+ (optional, with graceful fallback)
- TypeScript 5+

### Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Build the project
npm run build

# Start development server
npm run dev

# Start production server
npm start
```

### Environment Variables

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/oxyhq

# Redis (Optional)
REDIS_URL=redis://localhost:6379

# JWT Secrets
ACCESS_TOKEN_SECRET=your_access_token_secret_here
REFRESH_TOKEN_SECRET=your_refresh_token_secret_here

# Rate Limiting
RATE_LIMIT_MAX=1000
AUTH_RATE_LIMIT_MAX=5
FILE_UPLOAD_RATE_LIMIT_MAX=50

# Security
CORS_ORIGIN=http://localhost:3000
```

## 📁 Project Structure

```
src/
├── config/           # Configuration management
│   ├── database.ts   # Database configuration
│   ├── redis.ts      # Redis configuration
│   └── server.ts     # Server configuration
├── controllers/      # Business logic controllers
│   ├── auth.ts       # Authentication controller
│   ├── users.ts      # User management
│   ├── files.ts      # File handling
│   └── ...
├── middleware/       # Express middleware
│   ├── auth.ts       # Authentication middleware
│   ├── cache.ts      # Caching middleware
│   ├── rateLimit.ts  # Rate limiting
│   ├── validation.ts # Input validation
│   └── ...
├── models/          # MongoDB schemas
│   ├── User.ts      # User model
│   ├── Session.ts   # Session model
│   └── ...
├── routes/          # API route definitions
│   ├── auth.ts      # Authentication routes
│   ├── users.ts     # User routes
│   └── ...
├── services/        # Business services
├── utils/           # Utility functions
│   ├── database.ts  # Database utilities
│   ├── logger.ts    # Logging utilities
│   └── ...
├── types/           # TypeScript type definitions
├── sockets/         # Socket.IO handlers
└── server.ts        # Main server file
```

## 🔧 API Endpoints

### Authentication
- `POST /auth/signup` - User registration
- `POST /auth/login` - User login
- `POST /auth/refresh` - Refresh access token
- `POST /auth/logout` - User logout
- `POST /auth/forgot-password` - Password reset request
- `POST /auth/reset-password` - Password reset

### Users
- `GET /users/profile` - Get current user profile
- `PUT /users/profile` - Update user profile
- `GET /users/:id` - Get user by ID
- `GET /users/search` - Search users
- `POST /users/follow/:id` - Follow user
- `DELETE /users/follow/:id` - Unfollow user

### Sessions
- `GET /sessions` - List user sessions
- `POST /sessions` - Create new session
- `PUT /sessions/:id` - Update session
- `DELETE /sessions/:id` - Delete session

### Files
- `POST /files/upload` - Upload file
- `GET /files/:id` - Get file info
- `DELETE /files/:id` - Delete file

### Search
- `GET /search/users` - Search users
- `GET /search/global` - Global search

### Analytics
- `GET /analytics/overview` - Analytics overview
- `GET /analytics/performance` - Performance metrics

### Notifications
- `GET /notifications` - Get notifications
- `PUT /notifications/:id/read` - Mark as read

### Privacy
- `GET /privacy/settings` - Get privacy settings
- `PUT /privacy/settings` - Update privacy settings

## 🚀 Performance Metrics

- **Response Time**: < 100ms average for cached requests
- **Throughput**: 1000+ requests per second
- **Memory Usage**: Optimized for low memory footprint
- **Database Queries**: < 50ms average query time
- **Cache Hit Rate**: > 80% for frequently accessed data

## 🔍 Health Monitoring

### Health Check Endpoint
```bash
GET /health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-06-29T21:28:47.956Z",
  "uptime": 19.338726765,
  "memory": {
    "rss": 542404608,
    "heapTotal": 447340544,
    "heapUsed": 405675736
  },
  "database": {
    "status": "healthy",
    "isConnected": true
  },
  "cache": false,
  "environment": "development"
}
```

## 📚 Documentation

- [API Reference](./docs/api-reference.md) - Complete API documentation
- [Authentication Guide](./docs/authentication.md) - Authentication flow and security
- [Performance Guide](./docs/performance.md) - Performance optimization guide
- [Deployment Guide](./docs/deployment.md) - Production deployment instructions
- [Development Guide](./docs/development.md) - Development setup and guidelines

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## 🚀 Deployment

### Production Build
```bash
npm run build
npm start
```

### Docker Deployment
```bash
docker build -t oxyhq-api .
docker run -p 3001:3001 oxyhq-api
```

### Environment Variables for Production
```env
NODE_ENV=production
PORT=3001
MONGODB_URI=mongodb://your-production-db
REDIS_URL=redis://your-production-redis
ACCESS_TOKEN_SECRET=your-production-secret
REFRESH_TOKEN_SECRET=your-production-refresh-secret
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [docs/](./docs/)
- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-repo/discussions)

---

Built with ❤️ by the OxyHQ Team