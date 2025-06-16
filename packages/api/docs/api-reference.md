# API Reference

Complete reference for all Oxy API endpoints.

## Base URL

- **Development**: `http://localhost:3001`
- **Production**: `https://your-api-domain.com`

## Authentication

Protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

## Response Format

All API responses follow this format:

**Success Response:**
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional success message"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

## Authentication Endpoints

### POST /api/auth/register

Register a new user account.

**Request Body:**
```json
{
  "username": "string",      // 3-30 characters, alphanumeric + underscore
  "email": "string",         // Valid email address
  "password": "string"       // Minimum 6 characters
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "jwt_string",
    "refreshToken": "jwt_string",
    "user": {
      "id": "user_id",
      "username": "testuser",
      "email": "test@example.com",
      "createdAt": "2025-06-13T10:00:00.000Z"
    }
  }
}
```

**Errors:**
- `400` - Invalid input data
- `409` - Username or email already exists

---

### POST /api/auth/login

Login with username/email and password.

**Request Body:**
```json
{
  "username": "string",      // Username or email
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "jwt_string",
    "refreshToken": "jwt_string",
    "user": {
      "id": "user_id",
      "username": "testuser",
      "email": "test@example.com"
    }
  }
}
```

**Errors:**
- `400` - Invalid input data
- `401` - Invalid credentials

---

### POST /api/auth/refresh

Refresh access token using refresh token.

**Request Body:**
```json
{
  "refreshToken": "jwt_string"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "jwt_string"
  }
}
```

**Errors:**
- `400` - Missing or invalid refresh token
- `401` - Refresh token expired or invalid

---

### GET /api/auth/validate

Validate current access token.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "user": {
      "id": "user_id",
      "username": "testuser",
      "email": "test@example.com"
    }
  }
}
```

**Errors:**
- `401` - Invalid or expired token

---

### POST /api/auth/logout

Logout and invalidate refresh token.

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

## User Management Endpoints

### GET /api/users/me

Get current user profile.

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
      "id": "user_id",
      "username": "testuser",
      "email": "test@example.com",
      "preferences": {
        "theme": "light",
        "language": "en"
      },
      "createdAt": "2025-06-13T10:00:00.000Z",
      "updatedAt": "2025-06-13T10:00:00.000Z"
    }
  }
}
```

**Errors:**
- `401` - Invalid or expired token

---

### PUT /api/users/me

Update current user profile.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "email": "newemail@example.com",    // Optional
  "preferences": {                    // Optional
    "theme": "dark",
    "language": "es"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_id",
      "username": "testuser",
      "email": "newemail@example.com",
      "preferences": {
        "theme": "dark",
        "language": "es"
      },
      "updatedAt": "2025-06-13T11:00:00.000Z"
    }
  }
}
```

**Errors:**
- `400` - Invalid input data
- `401` - Invalid or expired token
- `409` - Email already in use

## Session Management Endpoints

### POST /api/secure-session/login

Create new device-based session.

**Request Body:**
```json
{
  "username": "string",
  "password": "string",
  "deviceFingerprint": "string",     // Unique device identifier
  "deviceInfo": {                    // Optional device metadata
    "userAgent": "string",
    "platform": "string",
    "deviceType": "mobile|desktop|tablet"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session_id",
    "accessToken": "jwt_string",
    "refreshToken": "jwt_string",
    "deviceId": "device_id",
    "user": {
      "id": "user_id",
      "username": "testuser",
      "email": "test@example.com"
    }
  }
}
```

---

### GET /api/secure-session/token/:sessionId

Get access token for specific session.

**Parameters:**
- `sessionId`: Active session ID

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "jwt_string",
    "expiresAt": "2025-06-13T11:00:00.000Z"
  }
}
```

**Errors:**
- `404` - Session not found or expired

---

### GET /api/secure-session/sessions

Get all active sessions for current user.

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
        "sessionId": "session_id",
        "deviceInfo": {
          "userAgent": "Mozilla/5.0...",
          "platform": "Windows",
          "deviceType": "desktop",
          "lastActive": "2025-06-13T10:30:00.000Z"
        },
        "isActive": true,
        "isCurrent": true,
        "createdAt": "2025-06-13T08:00:00.000Z"
      }
    ]
  }
}
```

---

### DELETE /api/secure-session/logout/:sessionId

Logout from specific session.

**Parameters:**
- `sessionId`: Session ID to logout

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "message": "Session logged out successfully"
}
```

---

### DELETE /api/secure-session/logout-all

Logout from all sessions except current.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "loggedOutSessions": 3
  },
  "message": "All other sessions logged out successfully"
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Invalid input data |
| `AUTHENTICATION_FAILED` | Invalid credentials |
| `TOKEN_EXPIRED` | JWT token has expired |
| `TOKEN_INVALID` | JWT token is malformed or invalid |
| `USER_NOT_FOUND` | User does not exist |
| `USER_ALREADY_EXISTS` | Username or email already taken |
| `SESSION_NOT_FOUND` | Session does not exist or expired |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `INTERNAL_ERROR` | Server error |

## Rate Limiting

Default rate limits:
- **Authentication endpoints**: 5 requests per minute per IP
- **General endpoints**: 100 requests per 15 minutes per IP
- **Session endpoints**: 20 requests per minute per user

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1623456789
```

## Status Codes

- `200` - OK
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `429` - Too Many Requests
- `500` - Internal Server Error
