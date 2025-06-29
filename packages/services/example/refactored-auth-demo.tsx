/**
 * Integration Example: Refactored Authentication System
 * 
 * This example demonstrates the simplified, centralized authentication
 * system with zero-config setup for both frontend and backend.
 */

import React from 'react';
import { OxyServices } from '../src/core';
import { OxyProvider, useAuthFetch, useOxy } from '../src/ui';

// ==================== BACKEND SETUP ====================

/**
 * Express.js Backend Integration Example
 */
function createBackendServer() {
  // This would be in your Express.js server
  const express = require('express');
  const app = express();
  
  // Initialize OxyServices for server-side auth validation
  const oxyServices = new OxyServices({
    baseURL: process.env.API_URL || 'http://localhost:3001'
  });
  
  // Zero-config authentication middleware
  const authenticateToken = oxyServices.createAuthenticateTokenMiddleware({
    loadFullUser: true,
    onError: (error) => {
      console.log('Authentication error:', error.message);
    }
  });
  
  // Protected route example
  app.get('/api/protected', authenticateToken, (req, res) => {
    res.json({
      message: 'Access granted to protected resource',
      user: req.user,
      userId: req.userId,
      timestamp: new Date().toISOString()
    });
  });
  
  // Custom validation example
  app.get('/api/custom-auth', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    const result = await oxyServices.authenticateToken(token);
    
    if (result.valid) {
      res.json({
        message: 'Custom authentication successful',
        user: result.user
      });
    } else {
      res.status(401).json({ error: result.error });
    }
  });
  
  return app;
}

// ==================== FRONTEND SETUP ====================

/**
 * App Root with Zero-Config Provider
 */
function App() {
  // Zero-config setup: just create OxyServices and wrap with provider
  const oxyServices = new OxyServices({
    baseURL: 'https://api.oxy.so'  // Configure your API URL
  });

  return (
    <OxyProvider oxyServices={oxyServices}>
      <AuthenticationDemo />
    </OxyProvider>
  );
}

/**
 * Authentication Demo Component
 */
function AuthenticationDemo() {
  const authFetch = useAuthFetch();
  const { isAuthenticated, user } = useOxy();
  const [response, setResponse] = React.useState(null);
  const [error, setError] = React.useState(null);

  // Example: Simple authenticated API call
  const fetchProtectedData = async () => {
    try {
      setError(null);
      const data = await authFetch.get('/api/protected');
      setResponse(data);
    } catch (err) {
      setError(err.message);
    }
  };

  // Example: POST request with data
  const createResource = async () => {
    try {
      setError(null);
      const data = await authFetch.post('/api/resources', {
        name: 'New Resource',
        description: 'Created via refactored auth system'
      });
      setResponse(data);
    } catch (err) {
      setError(err.message);
    }
  };

  // Example: Update API URL at runtime
  const switchToDevAPI = () => {
    authFetch.setApiUrl('http://localhost:3001');
    alert('Switched to development API');
  };

  const switchToProdAPI = () => {
    authFetch.setApiUrl('https://api.oxy.so');
    alert('Switched to production API');
  };

  // Example: Login
  const handleLogin = async () => {
    try {
      await authFetch.login('testuser', 'password123');
      alert('Login successful!');
    } catch (err) {
      alert(`Login failed: ${err.message}`);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Refactored Authentication System Demo</h1>
      
      {/* Authentication Status */}
      <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#f5f5f5' }}>
        <h3>Authentication Status</h3>
        <p><strong>Authenticated:</strong> {isAuthenticated ? '✅ Yes' : '❌ No'}</p>
        <p><strong>User:</strong> {user?.username || 'Not logged in'}</p>
      </div>

      {/* API Controls */}
      <div style={{ marginBottom: '20px' }}>
        <h3>API Configuration</h3>
        <button onClick={switchToDevAPI} style={{ marginRight: '10px' }}>
          Switch to Dev API
        </button>
        <button onClick={switchToProdAPI}>
          Switch to Prod API
        </button>
      </div>

      {/* Authentication Actions */}
      <div style={{ marginBottom: '20px' }}>
        <h3>Authentication Actions</h3>
        {!isAuthenticated ? (
          <button onClick={handleLogin}>
            Login (Demo)
          </button>
        ) : (
          <button onClick={authFetch.logout}>
            Logout
          </button>
        )}
      </div>

      {/* API Testing */}
      <div style={{ marginBottom: '20px' }}>
        <h3>API Testing</h3>
        <button 
          onClick={fetchProtectedData}
          disabled={!isAuthenticated}
          style={{ marginRight: '10px' }}
        >
          Fetch Protected Data
        </button>
        <button 
          onClick={createResource}
          disabled={!isAuthenticated}
        >
          Create Resource
        </button>
      </div>

      {/* Response Display */}
      {response && (
        <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#e8f5e8' }}>
          <h4>API Response:</h4>
          <pre>{JSON.stringify(response, null, 2)}</pre>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#ffe8e8' }}>
          <h4>Error:</h4>
          <p>{error}</p>
        </div>
      )}

      {/* Features Overview */}
      <div style={{ marginTop: '30px', padding: '15px', backgroundColor: '#f0f8ff' }}>
        <h3>Key Features Demonstrated</h3>
        <ul>
          <li>✅ Zero-config setup (just wrap with OxyProvider)</li>
          <li>✅ Automatic token management</li>
          <li>✅ Runtime API URL configuration</li>
          <li>✅ Consistent error handling</li>
          <li>✅ Simple, intuitive API</li>
          <li>✅ Production-ready (no debug logs)</li>
          <li>✅ Full TypeScript support</li>
          <li>✅ Seamless integration with useOxy</li>
        </ul>
      </div>
    </div>
  );
}

// ==================== USAGE EXAMPLES ====================

/**
 * Custom Hook Example: Domain-specific API calls
 */
function useUserAPI() {
  const authFetch = useAuthFetch();

  return {
    getUserProfile: () => authFetch.get('/api/users/me'),
    updateProfile: (data) => authFetch.put('/api/users/me', data),
    uploadAvatar: (file) => authFetch.post('/api/users/me/avatar', { file }),
    deleteAccount: () => authFetch.delete('/api/users/me'),
  };
}

/**
 * React Native Example
 */
function ReactNativeComponent() {
  const authFetch = useAuthFetch();
  const userAPI = useUserAPI();

  const handleProfileUpdate = async () => {
    try {
      const result = await userAPI.updateProfile({
        firstName: 'John',
        lastName: 'Doe'
      });
      console.log('Profile updated:', result);
    } catch (error) {
      console.error('Update failed:', error);
    }
  };

  // Component JSX would go here...
  return null;
}

/**
 * Node.js Server Example
 */
function nodeJSExample() {
  const { OxyServices } = require('@oxyhq/services/core');
  
  const oxyServices = new OxyServices({
    baseURL: process.env.API_URL
  });
  
  // Custom authentication logic
  async function validateRequest(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    const result = await oxyServices.authenticateToken(token);
    
    if (result.valid) {
      req.user = result.user;
      req.userId = result.userId;
      next();
    } else {
      res.status(401).json({ error: 'Authentication required' });
    }
  }
  
  return validateRequest;
}

export default App;
export { 
  createBackendServer, 
  useUserAPI, 
  ReactNativeComponent, 
  nodeJSExample 
};