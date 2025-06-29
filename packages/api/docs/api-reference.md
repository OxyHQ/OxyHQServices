# API Reference

Complete API documentation for the OxyHQ backend service.

## Base URL

```
http://localhost:3001
```

## Authentication

Most endpoints require authentication using JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer <access_token>
```

## Response Format

All API responses follow a consistent format:

### Success Response
```json
{
  "success": true,
  "data": {
    // Response data
  },
  "message": "Operation successful"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description",
    "details": {}
  }
}
```

## Authentication Endpoints

### POST /auth/signup

Register a new user account.

**Request Body:**
```json
{
  "username": "johndoe",
  "email": "john@example.com",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "username": "johndoe",
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "createdAt": "2025-06-29T21:28:47.956Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  },
  "message": "User registered successfully"
}
```

### POST /auth/login

Authenticate user and get access tokens.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "securePassword123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "username": "johndoe",
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  },
  "message": "Login successful"
}
```

### POST /auth/refresh

Refresh access token using refresh token.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  "message": "Token refreshed successfully"
}
```

### POST /auth/logout

Logout user and invalidate tokens.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### POST /auth/forgot-password

Request password reset email.

**Request Body:**
```json
{
  "email": "john@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Password reset email sent"
}
```

### POST /auth/reset-password

Reset password using reset token.

**Request Body:**
```json
{
  "token": "reset_token_here",
  "newPassword": "newSecurePassword123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Password reset successfully"
}
```

## User Endpoints

### GET /users/profile

Get current user's profile.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "username": "johndoe",
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "bio": "Software developer",
      "avatar": "https://example.com/avatar.jpg",
      "location": "San Francisco, CA",
      "website": "https://johndoe.com",
      "isOnline": true,
      "lastSeen": "2025-06-29T21:28:47.956Z",
      "followers": 150,
      "following": 75,
      "createdAt": "2025-06-29T21:28:47.956Z",
      "privacySettings": {
        "isPrivateAccount": false,
        "showEmail": true,
        "showLocation": true
      }
    }
  }
}
```

### PUT /users/profile

Update user profile.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "bio": "Updated bio",
  "location": "New York, NY",
  "website": "https://newwebsite.com"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "firstName": "John",
      "lastName": "Doe",
      "bio": "Updated bio",
      "location": "New York, NY",
      "website": "https://newwebsite.com"
    }
  },
  "message": "Profile updated successfully"
}
```

### GET /users/:id

Get user by ID.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "username": "johndoe",
      "firstName": "John",
      "lastName": "Doe",
      "bio": "Software developer",
      "avatar": "https://example.com/avatar.jpg",
      "location": "San Francisco, CA",
      "website": "https://johndoe.com",
      "isOnline": true,
      "lastSeen": "2025-06-29T21:28:47.956Z",
      "followers": 150,
      "following": 75,
      "createdAt": "2025-06-29T21:28:47.956Z",
      "isFollowing": true
    }
  }
}
```

### GET /users/search

Search users.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Query Parameters:**
- `q` (string): Search query
- `limit` (number): Number of results (default: 20)
- `offset` (number): Number of results to skip (default: 0)

**Response:**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "507f1f77bcf86cd799439011",
        "username": "johndoe",
        "firstName": "John",
        "lastName": "Doe",
        "avatar": "https://example.com/avatar.jpg",
        "isFollowing": false
      }
    ],
    "total": 1,
    "limit": 20,
    "offset": 0
  }
}
```

### POST /users/follow/:id

Follow a user.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "message": "User followed successfully"
}
```

### DELETE /users/follow/:id

Unfollow a user.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "message": "User unfollowed successfully"
}
```

## Session Endpoints

### GET /sessions

Get user's active sessions.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "507f1f77bcf86cd799439011",
        "deviceId": "device_123",
        "deviceInfo": {
          "browser": "Chrome",
          "os": "Windows",
          "ip": "192.168.1.1"
        },
        "isActive": true,
        "lastActivity": "2025-06-29T21:28:47.956Z",
        "createdAt": "2025-06-29T21:28:47.956Z"
      }
    ]
  }
}
```

### DELETE /sessions/:id

Terminate a specific session.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "message": "Session terminated successfully"
}
```

## File Endpoints

### POST /files/upload

Upload a file.

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

**Form Data:**
- `file`: File to upload
- `type` (optional): File type category

**Response:**
```json
{
  "success": true,
  "data": {
    "file": {
      "id": "507f1f77bcf86cd799439011",
      "filename": "image.jpg",
      "originalName": "photo.jpg",
      "mimeType": "image/jpeg",
      "size": 1024000,
      "url": "https://cdn.example.com/files/image.jpg",
      "uploadedBy": "507f1f77bcf86cd799439011",
      "createdAt": "2025-06-29T21:28:47.956Z"
    }
  },
  "message": "File uploaded successfully"
}
```

### GET /files/:id

Get file information.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "file": {
      "id": "507f1f77bcf86cd799439011",
      "filename": "image.jpg",
      "originalName": "photo.jpg",
      "mimeType": "image/jpeg",
      "size": 1024000,
      "url": "https://cdn.example.com/files/image.jpg",
      "uploadedBy": "507f1f77bcf86cd799439011",
      "createdAt": "2025-06-29T21:28:47.956Z"
    }
  }
}
```

### DELETE /files/:id

Delete a file.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

## Search Endpoints

### GET /search/users

Search users with advanced filters.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Query Parameters:**
- `q` (string): Search query
- `location` (string): Filter by location
- `limit` (number): Number of results (default: 20)
- `offset` (number): Number of results to skip (default: 0)

**Response:**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "507f1f77bcf86cd799439011",
        "username": "johndoe",
        "firstName": "John",
        "lastName": "Doe",
        "avatar": "https://example.com/avatar.jpg",
        "location": "San Francisco, CA",
        "isFollowing": false
      }
    ],
    "total": 1,
    "limit": 20,
    "offset": 0
  }
}
```

### GET /search/global

Global search across all content types.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Query Parameters:**
- `q` (string): Search query
- `type` (string): Content type filter (users, files, etc.)
- `limit` (number): Number of results (default: 20)
- `offset` (number): Number of results to skip (default: 0)

**Response:**
```json
{
  "success": true,
  "data": {
    "results": {
      "users": [
        {
          "id": "507f1f77bcf86cd799439011",
          "username": "johndoe",
          "firstName": "John",
          "lastName": "Doe",
          "avatar": "https://example.com/avatar.jpg"
        }
      ],
      "files": [
        {
          "id": "507f1f77bcf86cd799439012",
          "filename": "document.pdf",
          "url": "https://cdn.example.com/files/document.pdf"
        }
      ]
    },
    "total": 2,
    "limit": 20,
    "offset": 0
  }
}
```

## Analytics Endpoints

### GET /analytics/overview

Get analytics overview.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalUsers": 1500,
      "activeUsers": 850,
      "totalFiles": 2500,
      "totalSessions": 3200,
      "growthRate": 15.5
    }
  }
}
```

### GET /analytics/performance

Get performance metrics.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "performance": {
      "averageResponseTime": 45,
      "requestsPerSecond": 1250,
      "errorRate": 0.5,
      "uptime": 99.9,
      "memoryUsage": 512,
      "cpuUsage": 25.5
    }
  }
}
```

## Notification Endpoints

### GET /notifications

Get user notifications.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Query Parameters:**
- `limit` (number): Number of results (default: 20)
- `offset` (number): Number of results to skip (default: 0)
- `unreadOnly` (boolean): Show only unread notifications (default: false)

**Response:**
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "507f1f77bcf86cd799439011",
        "type": "follow",
        "title": "New Follower",
        "message": "johndoe started following you",
        "isRead": false,
        "actorId": "507f1f77bcf86cd799439012",
        "entityId": "507f1f77bcf86cd799439011",
        "createdAt": "2025-06-29T21:28:47.956Z"
      }
    ],
    "total": 1,
    "unreadCount": 5
  }
}
```

### PUT /notifications/:id/read

Mark notification as read.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "message": "Notification marked as read"
}
```

## Privacy Endpoints

### GET /privacy/settings

Get user privacy settings.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "privacySettings": {
      "isPrivateAccount": false,
      "showEmail": true,
      "showLocation": true,
      "showOnlineStatus": true,
      "allowFollowRequests": true,
      "showFollowers": true,
      "showFollowing": true
    }
  }
}
```

### PUT /privacy/settings

Update privacy settings.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "isPrivateAccount": true,
  "showEmail": false,
  "showLocation": true,
  "showOnlineStatus": false,
  "allowFollowRequests": true,
  "showFollowers": true,
  "showFollowing": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "privacySettings": {
      "isPrivateAccount": true,
      "showEmail": false,
      "showLocation": true,
      "showOnlineStatus": false,
      "allowFollowRequests": true,
      "showFollowers": true,
      "showFollowing": false
    }
  },
  "message": "Privacy settings updated successfully"
}
```

## Health & Monitoring

### GET /health

Get system health status.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-06-29T21:28:47.956Z",
  "uptime": 19.338726765,
  "memory": {
    "rss": 542404608,
    "heapTotal": 447340544,
    "heapUsed": 405675736,
    "external": 26027986,
    "arrayBuffers": 23049480
  },
  "database": {
    "status": "healthy",
    "isConnected": true,
    "metrics": {
      "queryCount": 0,
      "slowQueries": [],
      "connectionErrors": 0,
      "lastQueryTime": "2025-06-29T21:28:34.870Z"
    }
  },
  "cache": false,
  "environment": "development"
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Authentication required |
| `FORBIDDEN` | Insufficient permissions |
| `NOT_FOUND` | Resource not found |
| `VALIDATION_ERROR` | Invalid input data |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `INTERNAL_ERROR` | Server error |
| `DUPLICATE_ENTRY` | Resource already exists |
| `INVALID_TOKEN` | Invalid or expired token |

## Rate Limiting

Different endpoints have different rate limits:

- **General endpoints**: 1000 requests per 15 minutes
- **Authentication endpoints**: 5 requests per 15 minutes
- **File upload endpoints**: 50 requests per hour

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```

## Pagination

List endpoints support pagination using `limit` and `offset` parameters:

```
GET /users/search?limit=20&offset=40
```

Response includes pagination metadata:
```json
{
  "data": [...],
  "total": 100,
  "limit": 20,
  "offset": 40,
  "hasMore": true
}
``` 