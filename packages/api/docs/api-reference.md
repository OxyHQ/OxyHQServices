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

## File Management Endpoints

### POST /api/files/upload-raw

Upload a file using raw data.

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/octet-stream
X-File-Name: filename.ext
X-User-Id: user_id
```

**Request Body:**
```
Raw file data (up to 50MB)
```

**Response:**
```json
{
  "_id": "file_id",
  "filename": "filename.ext",
  "size": 12345,
  "mimetype": "image/jpeg"
}
```

**Errors:**
- `400` - Missing required headers or invalid data
- `401` - Invalid or expired token
- `403` - Unauthorized
- `413` - File too large

---

### GET /api/files/:id

Stream/download a file.

**Response:**
```
File stream with appropriate headers
```

**Errors:**
- `400` - Invalid file ID
- `404` - File not found

---

### GET /api/files/meta/:id

Get file metadata.

**Response:**
```json
{
  "_id": "file_id",
  "filename": "filename.ext",
  "contentType": "image/jpeg",
  "length": 12345,
  "uploadDate": "2025-06-13T10:00:00.000Z",
  "metadata": {
    "userID": "user_id",
    "originalname": "filename.ext",
    "size": 12345
  }
}
```

**Errors:**
- `400` - Invalid file ID
- `404` - File not found

---

### GET /api/files/list/:userID

List all files for a user.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
[
  {
    "_id": "file_id",
    "filename": "filename.ext",
    "contentType": "image/jpeg",
    "length": 12345,
    "uploadDate": "2025-06-13T10:00:00.000Z"
  }
]
```

**Errors:**
- `400` - Invalid user ID
- `401` - Invalid or expired token
- `403` - Unauthorized to access these files

---

### DELETE /api/files/:id

Delete a file.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "message": "File deleted successfully"
}
```

**Errors:**
- `400` - Invalid file ID
- `401` - Invalid or expired token
- `403` - Unauthorized to delete this file
- `404` - File not found

## Profile & Social Endpoints

### GET /api/profiles/username/:username

Get profile by username.

**Response:**
```json
{
  "id": "user_id",
  "username": "testuser",
  "name": {
    "first": "John",
    "last": "Doe"
  },
  "avatar": "avatar_url",
  "description": "User bio",
  "createdAt": "2025-06-13T10:00:00.000Z"
}
```

**Errors:**
- `404` - Profile not found

---

### GET /api/profiles/search

Search profiles.

**Query Parameters:**
- `query` (required): Search term
- `limit` (optional): Number of results (default: 10)
- `offset` (optional): Number to skip (default: 0)

**Response:**
```json
[
  {
    "id": "user_id",
    "username": "testuser",
    "name": {
      "first": "John",
      "last": "Doe"
    },
    "avatar": "avatar_url",
    "description": "User bio",
    "_count": {
      "followers": 42,
      "following": 15
    }
  }
]
```

**Errors:**
- `400` - Missing search query

---

### GET /api/profiles/recommendations

Get recommended profiles.

**Headers:**
```
Authorization: Bearer <access_token>  // Optional
```

**Query Parameters:**
- `limit` (optional): Number of results (default: 10)
- `offset` (optional): Number to skip (default: 0)

**Response:**
```json
[
  {
    "_id": "user_id",
    "username": "testuser",
    "name": {
      "first": "John",
      "last": "Doe"
    },
    "avatar": "avatar_url",
    "description": "User bio",
    "mutualCount": 5,
    "followersCount": 42,
    "followingCount": 15
  }
]
```

## Notification Endpoints

### GET /api/notifications

Get all notifications for the authenticated user.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "notification_id",
        "type": "follow",
        "title": "New Follower",
        "message": "John Doe started following you",
        "isRead": false,
        "createdAt": "2025-06-13T10:00:00.000Z"
      }
    ]
  }
}
```

---

### GET /api/notifications/unread-count

Get unread notification count.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "count": 5
  }
}
```

---

### PUT /api/notifications/:id/read

Mark a notification as read.

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

---

### PUT /api/notifications/read-all

Mark all notifications as read.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "message": "All notifications marked as read"
}
```

---

### DELETE /api/notifications/:id

Delete a notification.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "message": "Notification deleted"
}
```

## Payment Endpoints

### POST /api/payments/process

Process a payment.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "amount": 1000,
  "currency": "USD",
  "paymentMethodId": "pm_1234567890",
  "description": "Premium subscription"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionId": "txn_1234567890",
    "status": "succeeded",
    "amount": 1000,
    "currency": "USD"
  }
}
```

---

### POST /api/payments/validate

Validate a payment method.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "paymentMethodId": "pm_1234567890"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "paymentMethod": {
      "id": "pm_1234567890",
      "type": "card",
      "last4": "4242"
    }
  }
}
```

---

### GET /api/payments/methods/:userId

Get payment methods for a user.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "paymentMethods": [
      {
        "id": "pm_1234567890",
        "type": "card",
        "last4": "4242",
        "brand": "visa",
        "expMonth": 12,
        "expYear": 2025
      }
    ]
  }
}
```

## Wallet Endpoints

### GET /api/wallet/:userId

Get wallet information.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "wallet": {
      "id": "wallet_id",
      "balance": 1000,
      "currency": "USD",
      "userId": "user_id"
    }
  }
}
```

---

### GET /api/wallet/transactions/:userId

Get transaction history.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "txn_1234567890",
        "type": "credit",
        "amount": 1000,
        "currency": "USD",
        "description": "Payment received",
        "status": "completed",
        "createdAt": "2025-06-13T10:00:00.000Z"
      }
    ]
  }
}
```

---

### GET /api/wallet/transaction/:transactionId

Get specific transaction details.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transaction": {
      "id": "txn_1234567890",
      "type": "credit",
      "amount": 1000,
      "currency": "USD",
      "description": "Payment received",
      "status": "completed",
      "metadata": {},
      "createdAt": "2025-06-13T10:00:00.000Z"
    }
  }
}
```

---

### POST /api/wallet/transfer

Transfer funds between wallets.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "fromUserId": "user_id",
  "toUserId": "recipient_id",
  "amount": 100,
  "currency": "USD",
  "description": "Payment for services"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionId": "txn_1234567890",
    "status": "completed"
  }
}
```

---

### POST /api/wallet/purchase

Process a purchase.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "userId": "user_id",
  "amount": 1000,
  "currency": "USD",
  "itemId": "item_123",
  "description": "Premium subscription"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionId": "txn_1234567890",
    "status": "completed"
  }
}
```

---

### POST /api/wallet/withdraw

Request a withdrawal.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "userId": "user_id",
  "amount": 500,
  "currency": "USD",
  "paymentMethodId": "pm_1234567890"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "withdrawalId": "wd_1234567890",
    "status": "pending"
  }
}
```

## Analytics Endpoints (Premium)

### GET /api/analytics

Get analytics data.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "analytics": {
      "profileViews": 150,
      "followers": 42,
      "engagement": 0.15,
      "topContent": []
    }
  }
}
```

---

### POST /api/analytics/update

Update analytics data.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "event": "profile_view",
  "data": {
    "viewerId": "viewer_id",
    "timestamp": "2025-06-13T10:00:00.000Z"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Analytics updated"
}
```

---

### GET /api/analytics/viewers

Get content viewers.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "viewers": [
      {
        "id": "viewer_id",
        "username": "viewer",
        "viewedAt": "2025-06-13T10:00:00.000Z"
      }
    ]
  }
}
```

---

### GET /api/analytics/followers

Get follower details.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "followers": [
      {
        "id": "follower_id",
        "username": "follower",
        "followedAt": "2025-06-13T10:00:00.000Z",
        "engagement": 0.25
      }
    ]
  }
}
```

## Search Endpoints

### GET /api/search

Search functionality.

**Query Parameters:**
- `q` (required): Search query
- `type` (optional): Search type (users, content, etc.)
- `limit` (optional): Number of results (default: 10)
- `offset` (optional): Number to skip (default: 0)

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "result_id",
        "type": "user",
        "title": "John Doe",
        "description": "User description"
      }
    ],
    "total": 25
  }
}
```

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
| `FILE_NOT_FOUND` | File does not exist |
| `FILE_TOO_LARGE` | File exceeds size limit |
| `PAYMENT_FAILED` | Payment processing failed |
| `INSUFFICIENT_FUNDS` | Wallet has insufficient balance |
| `PREMIUM_REQUIRED` | Premium subscription required |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `INTERNAL_ERROR` | Server error |

## Rate Limiting

Default rate limits:
- **Authentication endpoints**: 5 requests per minute per IP
- **File upload endpoints**: 10 requests per minute per user
- **General endpoints**: 100 requests per 15 minutes per IP
- **Session endpoints**: 20 requests per minute per user
- **Payment endpoints**: 30 requests per minute per user

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
- `413` - Payload Too Large
- `429` - Too Many Requests
- `500` - Internal Server Error

## Socket.IO Events

### Client to Server
- `join_room` - Join a specific room
- `leave_room` - Leave a specific room

### Server to Client
- `notification` - New notification received
- `session_update` - Session status updated
- `payment_update` - Payment status updated
- `wallet_update` - Wallet balance updated
