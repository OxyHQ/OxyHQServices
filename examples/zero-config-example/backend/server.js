import express from 'express';
import cors from 'cors';
import { createOxyAuth, createOptionalOxyAuth } from '@oxyhq/services/node';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000'], // Allow React app
  credentials: true
}));
app.use(express.json());

// Public routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Zero-Config OxyHQ Services Backend Example',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Optional auth route (works with or without authentication)
app.use('/api/public', createOptionalOxyAuth({
  baseURL: process.env.OXY_API_URL || 'http://localhost:3001'
}));

app.get('/api/public/content', (req, res) => {
  if (req.user) {
    // User is authenticated
    res.json({
      content: 'personalized',
      message: `Hello ${req.user.username}! This is personalized content.`,
      user: req.user,
      authStatus: 'authenticated'
    });
  } else {
    // Anonymous user
    res.json({
      content: 'public',
      message: 'This is public content for anonymous users.',
      authStatus: 'anonymous'
    });
  }
});

// Protected routes with zero-config authentication
app.use('/api', createOxyAuth({
  baseURL: process.env.OXY_API_URL || 'http://localhost:3001',
  loadUser: true, // Load full user data (default)
  onError: (error, req, res) => {
    console.error('Authentication error:', error);
    return res.status(error.status || 401).json({
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });
  }
}));

// All routes under /api now have req.user automatically populated
app.get('/api/profile', (req, res) => {
  res.json({
    message: `Welcome to your profile, ${req.user.username}!`,
    user: req.user,
    userId: req.userId,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/protected-data', (req, res) => {
  res.json({
    message: 'This is protected data',
    data: {
      secretValue: 42,
      userSpecificData: `Data for user ${req.user.username}`,
      permissions: req.user.roles || ['user']
    },
    user: {
      id: req.userId,
      username: req.user.username,
      email: req.user.email
    }
  });
});

app.post('/api/update-profile', (req, res) => {
  // In a real app, you would update the user in your database
  res.json({
    message: 'Profile updated successfully',
    user: req.user,
    updatedFields: req.body,
    timestamp: new Date().toISOString()
  });
});

// Demonstrate req.user access in multiple routes
app.get('/api/dashboard-stats', (req, res) => {
  res.json({
    stats: {
      loginCount: Math.floor(Math.random() * 100),
      lastLogin: new Date(Date.now() - Math.random() * 86400000).toISOString(),
      accountAge: crypto.randomInt(0, 365)
    },
    user: req.user.username,
    generated: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Zero-Config Backend Example Server running on port ${PORT}`);
  console.log(`📱 API available at http://localhost:${PORT}`);
  console.log(`🔒 Protected endpoints: http://localhost:${PORT}/api/*`);
  console.log(`🌍 Public endpoints: http://localhost:${PORT}/api/public/*`);
  console.log('');
  console.log('✨ Features:');
  console.log('  - Zero-config authentication with req.user auto-population');
  console.log('  - Optional authentication for mixed public/private routes');
  console.log('  - Built-in error handling and token validation');
  console.log('  - CORS configured for React frontend');
});