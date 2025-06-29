/**
 * Test component to verify the new Zustand-based architecture
 */

import React from 'react';
import { OxyContextProvider, useOxy } from '../ui/context/OxyContext';
import { OxyServices } from '../../core';

// Mock OxyServices for testing
const mockOxyServices = new OxyServices({
  baseURL: 'http://localhost:3001'
});

// Test Auth Component
const TestAuthComponent: React.FC = () => {
  const { 
    user, 
    isAuthenticated, 
    isLoading, 
    error, 
    login, 
    logout, 
    clearError 
  } = useOxy();

  const handleLogin = async () => {
    try {
      await login('testuser', 'testpass');
    } catch (err) {
      console.error('Login failed:', err);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  return (
    <div style={{ padding: 20, border: '1px solid #ccc', margin: 10 }}>
      <h3>Auth Test Component</h3>
      <div>
        <strong>Is Authenticated:</strong> {isAuthenticated ? 'Yes' : 'No'}
      </div>
      <div>
        <strong>Is Loading:</strong> {isLoading ? 'Yes' : 'No'}
      </div>
      <div>
        <strong>User:</strong> {user ? user.username : 'None'}
      </div>
      {error && (
        <div style={{ color: 'red' }}>
          <strong>Error:</strong> {error}
          <button onClick={clearError} style={{ marginLeft: 10 }}>
            Clear Error
          </button>
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <button onClick={handleLogin} disabled={isLoading}>
          Login
        </button>
        <button onClick={handleLogout} disabled={isLoading} style={{ marginLeft: 10 }}>
          Logout
        </button>
      </div>
    </div>
  );
};

// Test Follow Component
const TestFollowComponent: React.FC = () => {
  const { 
    followingUsers, 
    loadingUsers, 
    followErrors,
    toggleFollow, 
    followUser, 
    unfollowUser,
    clearFollowError 
  } = useOxy();

  const testUserId = 'test-user-123';
  const isFollowing = followingUsers[testUserId] || false;
  const isLoading = loadingUsers[testUserId] || false;
  const error = followErrors[testUserId];

  const handleToggleFollow = async () => {
    try {
      await toggleFollow(testUserId);
    } catch (err) {
      console.error('Toggle follow failed:', err);
    }
  };

  const handleFollow = async () => {
    try {
      await followUser(testUserId);
    } catch (err) {
      console.error('Follow failed:', err);
    }
  };

  const handleUnfollow = async () => {
    try {
      await unfollowUser(testUserId);
    } catch (err) {
      console.error('Unfollow failed:', err);
    }
  };

  return (
    <div style={{ padding: 20, border: '1px solid #ccc', margin: 10 }}>
      <h3>Follow Test Component</h3>
      <div>
        <strong>Test User ID:</strong> {testUserId}
      </div>
      <div>
        <strong>Is Following:</strong> {isFollowing ? 'Yes' : 'No'}
      </div>
      <div>
        <strong>Is Loading:</strong> {isLoading ? 'Yes' : 'No'}
      </div>
      {error && (
        <div style={{ color: 'red' }}>
          <strong>Error:</strong> {error}
          <button onClick={() => clearFollowError(testUserId)} style={{ marginLeft: 10 }}>
            Clear Error
          </button>
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <button onClick={handleToggleFollow} disabled={isLoading}>
          Toggle Follow
        </button>
        <button onClick={handleFollow} disabled={isLoading} style={{ marginLeft: 10 }}>
          Follow
        </button>
        <button onClick={handleUnfollow} disabled={isLoading} style={{ marginLeft: 10 }}>
          Unfollow
        </button>
      </div>
    </div>
  );
};

// Main Test App
const TestApp: React.FC = () => {
  return (
    <OxyContextProvider oxyServices={mockOxyServices}>
      <div style={{ fontFamily: 'Arial, sans-serif' }}>
        <h1>Oxy Services Test App</h1>
        <p>This tests the new Zustand-based architecture</p>
        <TestAuthComponent />
        <TestFollowComponent />
      </div>
    </OxyContextProvider>
  );
};

export default TestApp;