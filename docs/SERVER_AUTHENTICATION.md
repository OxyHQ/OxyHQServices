# Server Authentication Guide

This guide demonstrates how to use `@oxyhq/services` for server-side authentication in Node.js and Express.js applications.

## Import Guide for Server-Side Usage

For server-side applications, use the main export which includes only core services and models (no UI components):

```javascript
// CommonJS
const { OxyServices, Models } = require('@oxyhq/services');

// ES Modules
import { OxyServices, Models } from '@oxyhq/services';
```

## Basic Setup

### Express.js Integration

```javascript
const express = require('express');
const { OxyServices, OXY_CLOUD_URL } = require('@oxyhq/services');

const app = express();
app.use(express.json());

// Initialize OxyServices
const oxyServices = new OxyServices({
  baseURL: OXY_CLOUD_URL, // or your self-hosted URL
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const result = await oxyServices.login(username, password);
    
    // Store tokens securely (in session, database, etc.)
    req.session.accessToken = result.accessToken;
    req.session.refreshToken = result.refreshToken;
    req.session.user = result.user;
    
    res.json({
      success: true,
      user: result.user
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: error.message
    });
  }
});

// Logout endpoint
app.post('/api/auth/logout', async (req, res) => {
  try {
    const { accessToken } = req.session;
    
    if (accessToken) {
      await oxyServices.logout(accessToken);
    }
    
    // Clear session
    req.session.destroy();
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});
```

## Authentication Middleware

Create middleware to protect routes:

```javascript
const { OxyServices } = require('@oxyhq/services');

const oxyServices = new OxyServices({
  baseURL: process.env.OXY_API_URL || 'https://api.oxy.so'
});

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }
    
    // Create a temporary OxyServices instance with the token to validate it
    const tempOxyServices = new OxyServices({
      baseURL: process.env.OXY_API_URL || 'https://api.oxy.so'
    });
    tempOxyServices.setTokens(token, ''); // Set access token
    
    // Validate token using the validate method
    const isValid = await tempOxyServices.validate();
    
    if (!isValid) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    
    // Get user ID from token
    const userId = tempOxyServices.getCurrentUserId();
    if (!userId) {
      return res.status(403).json({ message: 'Invalid token payload' });
    }
    
    req.userId = userId;
    req.accessToken = token;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Token validation failed' });
  }
};

// Protected route example
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    // User is authenticated, req.userId contains user ID
    const userOxyServices = new OxyServices({
      baseURL: process.env.OXY_API_URL || 'https://api.oxy.so'
    });
    userOxyServices.setTokens(req.accessToken, ''); // Set the validated token
    
    const profile = await userOxyServices.getUserById(req.userId);
    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
```

## Token Management

### Automatic Token Refresh

```javascript
const { OxyServices } = require('@oxyhq/services');

class AuthService {
  constructor() {
    this.oxyServices = new OxyServices({
      baseURL: process.env.OXY_API_URL || 'https://api.oxy.so'
    });
  }
  
  async refreshUserToken(refreshToken) {
    try {
      const result = await this.oxyServices.refreshToken(refreshToken);
      return result;
    } catch (error) {
      throw new Error('Token refresh failed: ' + error.message);
    }
  }
  
  async authenticateRequest(req, res, next) {
    try {
      let { accessToken, refreshToken } = req.session;
      
      if (!accessToken) {
        return res.status(401).json({ message: 'No access token' });
      }
      
      try {
        // Try to validate current token
        const tempOxyServices = new OxyServices({
          baseURL: process.env.OXY_API_URL || 'https://api.oxy.so'
        });
        tempOxyServices.setTokens(accessToken, refreshToken || '');
        
        const isValid = await tempOxyServices.validate();
        if (!isValid) {
          throw new Error('Token invalid');
        }
        
        const userId = tempOxyServices.getCurrentUserId();
        req.userId = userId;
        req.accessToken = accessToken;
        return next();
      } catch (tokenError) {
        // Token invalid/expired, try to refresh
        if (refreshToken) {
          try {
            const refreshResult = await this.refreshUserToken(refreshToken);
            
            // Update session with new tokens
            req.session.accessToken = refreshResult.accessToken;
            req.session.refreshToken = refreshResult.refreshToken;
            
            const tempOxyServices = new OxyServices({
              baseURL: process.env.OXY_API_URL || 'https://api.oxy.so'
            });
            tempOxyServices.setTokens(refreshResult.accessToken, refreshResult.refreshToken);
            
            req.userId = tempOxyServices.getCurrentUserId();
            req.accessToken = refreshResult.accessToken;
            return next();
          } catch (refreshError) {
            // Refresh failed, clear session
            req.session.destroy();
            return res.status(401).json({ message: 'Authentication expired' });
          }
        } else {
          return res.status(401).json({ message: 'Invalid token' });
        }
      }
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
}

const authService = new AuthService();
app.use('/api/protected', authService.authenticateRequest.bind(authService));
```

## User Management Operations

### Creating and Managing Users

```javascript
const { OxyServices, Models } = require('@oxyhq/services');

const oxyServices = new OxyServices({
  baseURL: process.env.OXY_API_URL
});

// Admin route to create user
app.post('/api/admin/users', authenticateAdminToken, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    const newUser = await oxyServices.signUp(username, email, password);
    
    res.json({
      success: true,
      user: newUser.user
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get user by ID
app.get('/api/users/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await oxyServices.getUserById(userId, req.accessToken);
    
    res.json(user);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
});

// Update user profile
app.put('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const updates = req.body;
    
    const userOxyServices = new OxyServices({
      baseURL: process.env.OXY_API_URL || 'https://api.oxy.so'
    });
    userOxyServices.setTokens(req.accessToken, ''); // Set the validated token
    
    const updatedUser = await userOxyServices.updateUser(
      req.userId,
      updates
    );
    
    res.json(updatedUser);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});
```

## Environment Configuration

Create a `.env` file for your server configuration:

```env
# Oxy API Configuration
OXY_API_URL=https://api.oxy.so
OXY_APP_ID=your-app-id
OXY_APP_SECRET=your-app-secret

# Session Configuration
SESSION_SECRET=your-session-secret
SESSION_TIMEOUT=3600000

# Database Configuration (if storing tokens)
DATABASE_URL=your-database-url
```

## Error Handling

```javascript
const { OxyServices } = require('@oxyhq/services');

// Global error handler for Oxy API errors
app.use((error, req, res, next) => {
  if (error.name === 'OxyAPIError') {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
      code: error.code
    });
  }
  
  // Handle other errors
  console.error('Unexpected error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// Centralized API error handling
const handleOxyRequest = async (req, res, operation) => {
  try {
    const result = await operation();
    res.json(result);
  } catch (error) {
    console.error('Oxy API Error:', error);
    
    if (error.response) {
      // HTTP error from Oxy API
      res.status(error.response.status).json({
        success: false,
        message: error.response.data?.message || error.message
      });
    } else {
      // Network or other error
      res.status(500).json({
        success: false,
        message: 'Service unavailable'
      });
    }
  }
};

// Usage example
app.get('/api/user/notifications', authenticateToken, (req, res) => {
  handleOxyRequest(req, res, () => {
    const userOxyServices = new OxyServices({
      baseURL: process.env.OXY_API_URL || 'https://api.oxy.so'
    });
    userOxyServices.setTokens(req.accessToken, ''); // Set the validated token
    
    return userOxyServices.getNotifications();
  });
});
```

## Best Practices

### 1. Token Security
- Never expose tokens in client-side code
- Use secure HTTP-only cookies for web applications
- Implement proper session management
- Set appropriate token expiration times

### 2. Error Handling
- Always handle authentication failures gracefully
- Implement retry logic for network errors
- Log security events for monitoring

### 3. Performance
- Cache user data when appropriate
- Implement connection pooling for high-traffic applications
- Use environment-specific configurations

### 4. Monitoring
- Log authentication events
- Monitor failed login attempts
- Track token refresh rates
- Set up alerts for unusual activity

## Example: Complete Express.js App

```javascript
const express = require('express');
const session = require('express-session');
const { OxyServices, OXY_CLOUD_URL } = require('@oxyhq/services');

const app = express();

// Middleware
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Initialize Oxy Services
const oxyServices = new OxyServices({
  baseURL: process.env.OXY_API_URL || OXY_CLOUD_URL
});

// Routes
app.post('/auth/login', async (req, res) => {
  // Login implementation
});

app.post('/auth/logout', async (req, res) => {
  // Logout implementation
});

app.get('/user/profile', authenticateToken, async (req, res) => {
  // Protected route implementation
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

This server-side authentication guide provides comprehensive examples for integrating `@oxyhq/services` in Node.js and Express.js applications, focusing on the core services without UI components.
