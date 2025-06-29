# OxyHQ API Documentation

Welcome to the comprehensive documentation for the OxyHQ API. This documentation covers everything you need to know about developing, deploying, and maintaining the API.

## 📚 Documentation Overview

### 🚀 Getting Started
- **[API Reference](./api-reference.md)** - Complete API documentation with all endpoints, request/response examples, and error codes
- **[Authentication Guide](./authentication.md)** - Comprehensive guide to JWT authentication, security best practices, and implementation examples
- **[Performance Guide](./performance.md)** - Performance optimization strategies, caching, database optimization, and monitoring
- **[Deployment Guide](./deployment.md)** - Production deployment instructions, Docker setup, Kubernetes configuration, and monitoring
- **[Development Guide](./development.md)** - Development setup, coding standards, testing, and contribution guidelines

## 🎯 Quick Start

### For Developers
1. **Setup**: Follow the [Development Guide](./development.md) for local setup
2. **API Reference**: Use the [API Reference](./api-reference.md) to understand available endpoints
3. **Authentication**: Read the [Authentication Guide](./authentication.md) for security implementation
4. **Testing**: Use the [Development Guide](./development.md) for testing best practices

### For DevOps/Operations
1. **Deployment**: Follow the [Deployment Guide](./deployment.md) for production setup
2. **Performance**: Review the [Performance Guide](./performance.md) for optimization
3. **Monitoring**: Set up monitoring using the [Deployment Guide](./deployment.md)

### For API Consumers
1. **API Reference**: Start with the [API Reference](./api-reference.md) for endpoint documentation
2. **Authentication**: Read the [Authentication Guide](./authentication.md) for integration
3. **Examples**: Find implementation examples in each guide

## 🏗️ Architecture Overview

The OxyHQ API is built with a modern, scalable architecture:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Apps   │    │   Load Balancer │    │   API Gateway   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│      CDN        │    │   API Servers   │    │   Redis Cache   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Monitoring    │    │   MongoDB DB    │    │   File Storage  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Key Components

- **Express.js**: Web framework with TypeScript
- **MongoDB**: Primary database with Mongoose ODM
- **Redis**: Caching layer with graceful fallback
- **JWT**: Authentication with refresh tokens
- **Winston**: Structured logging
- **Helmet**: Security headers
- **Rate Limiting**: Advanced rate limiting strategies

## 🔧 Technology Stack

| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| Runtime | Node.js | 18+ | JavaScript runtime |
| Language | TypeScript | 5+ | Type-safe JavaScript |
| Framework | Express.js | 4+ | Web framework |
| Database | MongoDB | 5+ | Document database |
| ODM | Mongoose | 7+ | MongoDB object modeling |
| Cache | Redis | 6+ | In-memory cache |
| Authentication | JWT | - | Token-based auth |
| Validation | Zod | 3+ | Runtime validation |
| Logging | Winston | 3+ | Structured logging |
| Security | Helmet | 7+ | Security headers |
| Testing | Jest | 29+ | Testing framework |

## 📊 Performance Metrics

The API is optimized for high performance:

- **Response Time**: < 100ms average for cached requests
- **Throughput**: 1000+ requests per second
- **Memory Usage**: Optimized for low memory footprint
- **Database Queries**: < 50ms average query time
- **Cache Hit Rate**: > 80% for frequently accessed data
- **Uptime**: 99.9% target availability

## 🔒 Security Features

- **JWT Authentication**: Secure token-based authentication
- **Rate Limiting**: Advanced rate limiting with progressive delays
- **Input Validation**: Zod-based runtime validation
- **Security Headers**: Comprehensive security headers with Helmet
- **CORS**: Secure cross-origin resource sharing
- **Password Hashing**: bcrypt with 12 salt rounds
- **Session Management**: Secure session handling with device tracking

## 🚀 Key Features

### Authentication & Authorization
- JWT-based authentication with refresh tokens
- Role-based access control
- Session management with device tracking
- Two-factor authentication support (planned)

### User Management
- User registration and login
- Profile management with privacy settings
- Follow/unfollow functionality
- User search and discovery
- Online status tracking

### File Management
- Secure file uploads with validation
- Image processing and optimization
- CDN integration ready
- File metadata management

### Real-time Features
- WebSocket connections with Socket.IO
- Real-time notifications
- Live chat support (planned)
- Online status broadcasting

### Analytics & Monitoring
- Request/response analytics
- Performance metrics tracking
- Error tracking and alerting
- Health monitoring endpoints

## 📈 API Endpoints Overview

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

### Health & Monitoring
- `GET /health` - System health status
- `GET /metrics` - Performance metrics (Prometheus format)

## 🛠️ Development Workflow

### 1. Local Development
```bash
# Clone repository
git clone https://github.com/your-org/oxyhq-services.git
cd oxyhq-services

# Install dependencies
npm install

# Set up environment
cp packages/api/.env.example packages/api/.env
# Edit .env with your configuration

# Start development server
npm run dev
```

### 2. Testing
```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run linting
npm run lint

# Fix linting issues
npm run lint:fix
```

### 3. Building
```bash
# Build for production
npm run build

# Start production server
npm start
```

## 📋 Environment Configuration

### Required Environment Variables

```env
# Server Configuration
NODE_ENV=development
PORT=3001
HOST=localhost

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
LOG_LEVEL=info

# File Upload
MAX_FILE_SIZE=10485760
UPLOAD_PATH=./uploads
```

## 🔍 Monitoring & Health Checks

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

### Metrics Endpoint
```bash
GET /metrics
```

Returns Prometheus-compatible metrics for monitoring.

## 🚀 Deployment Options

### 1. Docker Deployment
```bash
# Build image
docker build -t oxyhq-api .

# Run container
docker run -p 3001:3001 oxyhq-api
```

### 2. Kubernetes Deployment
```bash
# Apply Kubernetes manifests
kubectl apply -f k8s/

# Check deployment status
kubectl get pods -n oxyhq
```

### 3. Cloud Platform Deployment
- **AWS**: ECS, EKS, or EC2
- **Google Cloud**: GKE or Cloud Run
- **Azure**: AKS or App Service
- **Heroku**: Direct deployment
- **Vercel**: Serverless deployment

## 📞 Support & Community

### Getting Help

1. **Documentation**: Check the relevant guide above
2. **GitHub Issues**: [Create an issue](https://github.com/your-org/oxyhq-services/issues)
3. **Discussions**: [Join discussions](https://github.com/your-org/oxyhq-services/discussions)
4. **Email Support**: [Contact support](#)

### Contributing

We welcome contributions! Please see the [Development Guide](./development.md) for:
- Code style guidelines
- Testing requirements
- Pull request process
- Development setup

### Community Resources

- **GitHub Repository**: [oxyhq-services](https://github.com/your-org/oxyhq-services)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/oxyhq-services/discussions)
- **Issues**: [GitHub Issues](https://github.com/your-org/oxyhq-services/issues)
- **Releases**: [GitHub Releases](https://github.com/your-org/oxyhq-services/releases)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../../LICENSE) file for details.

## 🙏 Acknowledgments

- **Express.js** team for the excellent web framework
- **MongoDB** team for the powerful database
- **Redis** team for the fast caching solution
- **TypeScript** team for the type-safe JavaScript
- **Jest** team for the testing framework
- **Winston** team for the logging solution

---

**Built with ❤️ by the OxyHQ Team**

*Last updated: June 2025* 