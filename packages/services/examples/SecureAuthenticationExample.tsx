import React from 'react';
import { OxyServices, OxyContextProvider, useOxy } from '../src';

// Example usage of the secure authentication system
const MyApp: React.FC = () => {
  const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });

  return (
    <OxyContextProvider 
      oxyServices={oxyServices}
      onAuthStateChange={(user) => {
        console.log('Auth state changed:', user ? `Logged in as ${user.username}` : 'Logged out');
      }}
    >
      <AppContent />
    </OxyContextProvider>
  );
};

const AppContent: React.FC = () => {
  const { 
    user, 
    minimalUser, 
    isAuthenticated, 
    isLoading, 
    sessions,
    activeSessionId,
    login, 
    logout,
    logoutAll,
    switchSession,
    removeSession,
    refreshSessions
  } = useOxy();

  const handleLogin = async () => {
    try {
      const user = await login('username', 'password', 'My Device');
      console.log('Logged in successfully:', user);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await logout(); // Logout current session
      console.log('Logged out successfully');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleLogoutAll = async () => {
    try {
      await logoutAll(); // Logout all sessions
      console.log('All sessions logged out');
    } catch (error) {
      console.error('Logout all failed:', error);
    }
  };

  const handleSwitchSession = async (sessionId: string) => {
    try {
      await switchSession(sessionId);
      console.log('Switched to session:', sessionId);
    } catch (error) {
      console.error('Session switch failed:', error);
    }
  };

  const handleRemoveSession = async (sessionId: string) => {
    try {
      await removeSession(sessionId);
      console.log('Session removed:', sessionId);
    } catch (error) {
      console.error('Session removal failed:', error);
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div>
        <h1>Please Login</h1>
        <button onClick={handleLogin}>Login</button>
        
        {/* 
          In the secure system, ONLY session identifiers are stored locally:
          - sessionId: "abc123..."
          - deviceId: "def456..."
          - expiresAt: "2025-06-01T12:00:00Z"
          - lastActive: "2025-05-27T10:30:00Z"
          
          NO sensitive data like email, full name, or tokens are stored!
        */}
      </div>
    );
  }

  return (
    <div>
      <h1>Welcome {user?.username}!</h1>
      
      {/* Show minimal user data for immediate UI display */}
      <div>
        <h2>Quick Info (stored locally):</h2>
        <p>Username: {minimalUser?.username}</p>
        <p>User ID: {minimalUser?.id}</p>
        {minimalUser?.avatar?.url && (
          <img src={minimalUser.avatar.url} alt="Avatar" width="50" height="50" />
        )}
      </div>

      {/* Show full user data (loaded from server) */}
      <div>
        <h2>Full Profile (loaded from server):</h2>
        <p>Email: {user?.email}</p>
        <p>Full Name: {user?.name?.full}</p>
        <p>Bio: {user?.bio}</p>
        <p>Karma: {user?.karma}</p>
        <p>Location: {user?.location}</p>
        <p>Website: {user?.website}</p>
      </div>

      {/* Session management */}
      <div>
        <h2>Active Sessions</h2>
        <p>Current Session: {activeSessionId}</p>
        
        <h3>All Sessions:</h3>
        {sessions.map((session) => (
          <div key={session.sessionId} style={{ border: '1px solid #ccc', margin: '10px', padding: '10px' }}>
            <p>Session ID: {session.sessionId}</p>
            <p>Device ID: {session.deviceId}</p>
            <p>Expires: {new Date(session.expiresAt).toLocaleString()}</p>
            <p>Active: {session.sessionId === activeSessionId ? 'Yes' : 'No'}</p>
            
            {session.sessionId !== activeSessionId && (
              <button onClick={() => handleSwitchSession(session.sessionId)}>
                Switch to this Session
              </button>
            )}
            
            <button onClick={() => handleRemoveSession(session.sessionId)}>
              Remove Session
            </button>
          </div>
        ))}
        
        <button onClick={refreshSessions}>Refresh Sessions</button>
      </div>

      <div>
        <button onClick={handleLogout}>Logout Current Session</button>
        <button onClick={handleLogoutAll}>Logout All Sessions</button>
      </div>
    </div>
  );
};

export default MyApp;

/*
  SECURE AUTHENTICATION SYSTEM - NOW THE DEFAULT!

  The OxyContext now uses secure session-based authentication by default.
  For legacy token-based auth, use LegacyOxyContextProvider instead.

  USAGE:
  ```typescript
  // NEW SECURE WAY (default)
  import { OxyContextProvider, useOxy } from 'oxyhqservices';
  
  // OLD INSECURE WAY (legacy)
  import { LegacyOxyContextProvider, useLegacyOxy } from 'oxyhqservices';
  ```

  1. ✅ NO PII STORED LOCALLY: Email, full name, phone numbers, etc. are never stored in localStorage/AsyncStorage
  2. ✅ NO TOKENS STORED LOCALLY: Access/refresh tokens are managed server-side only
  3. ✅ SESSION-BASED: Only session identifiers are stored, which are meaningless without server validation
  4. ✅ DEVICE TRACKING: Each session has a unique device ID for better security monitoring
  5. ✅ AUTOMATIC CLEANUP: Invalid sessions are automatically removed from local storage
  6. ✅ MULTI-SESSION SUPPORT: Users can be logged in on multiple devices securely
  7. ✅ SERVER-SIDE VALIDATION: All sensitive operations require server validation
  8. ✅ REDUCED XSS RISK: Even if XSS occurs, no sensitive data can be extracted
  9. ✅ GRANULAR LOGOUT: Can logout specific sessions or all sessions
  10. ✅ SESSION MONITORING: Users can see all their active sessions and manage them

  WHAT'S STORED LOCALLY (EXAMPLE):
  {
    "oxy_secure_sessions": [
      {
        "sessionId": "abc123-def456-ghi789",
        "deviceId": "device_xyz789",
        "expiresAt": "2025-06-01T12:00:00.000Z",
        "lastActive": "2025-05-27T10:30:00.000Z"
      }
    ],
    "oxy_secure_active_session_id": "abc123-def456-ghi789"
  }

  NO SENSITIVE DATA = NO SECURITY RISK!
*/
