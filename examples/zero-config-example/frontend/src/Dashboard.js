import React, { useState, useEffect } from 'react';
import { useOxyZeroConfig, useOxyApi } from '@oxyhq/services/ui';

/**
 * Dashboard Component - Demonstrates zero-config authentication usage
 * 
 * This shows how simple it is to use authentication with the zero-config approach:
 * - No manual token management
 * - No complex state handling
 * - Just use the hook and everything works
 */
function Dashboard() {
  const { 
    user, 
    login, 
    logout, 
    register, 
    isAuthenticated, 
    isLoading, 
    error 
  } = useOxyZeroConfig();

  const api = useOxyApi(); // Direct API access with auto token handling

  const [serverData, setServerData] = useState(null);
  const [publicData, setPublicData] = useState(null);
  const [loadingData, setLoadingData] = useState(false);

  // Demo login credentials
  const demoCredentials = {
    username: 'demo',
    password: 'password'
  };

  // Fetch data from backend when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchServerData();
      fetchPublicData(); // This will show personalized content
    } else {
      fetchPublicData(); // This will show anonymous content
    }
  }, [isAuthenticated]);

  const fetchServerData = async () => {
    if (!isAuthenticated) return;
    
    setLoadingData(true);
    try {
      // Fetch from protected endpoint
      const token = localStorage.getItem('oxy_zero_accessToken');
      const response = await fetch('/api/profile', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setServerData(data);
      } else {
        console.error('Failed to fetch server data:', response.statusText);
      }
    } catch (error) {
      console.error('Error fetching server data:', error);
    } finally {
      setLoadingData(false);
    }
  };

  const fetchPublicData = async () => {
    try {
      // Fetch from public endpoint (works with or without auth)
      const token = localStorage.getItem('oxy_zero_accessToken');
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/public/content', { headers });
      
      if (response.ok) {
        const data = await response.json();
        setPublicData(data);
      }
    } catch (error) {
      console.error('Error fetching public data:', error);
    }
  };

  const handleLogin = async () => {
    try {
      await login(demoCredentials.username, demoCredentials.password);
    } catch (err) {
      console.error('Login failed:', err);
    }
  };

  const handleRegister = async () => {
    try {
      const newUsername = `user${Date.now()}`;
      const newEmail = `${newUsername}@example.com`;
      await register(newUsername, newEmail, 'password123');
    } catch (err) {
      console.error('Registration failed:', err);
    }
  };

  const handleDirectApiCall = async () => {
    try {
      // Demonstrate direct API usage with automatic token handling
      const updatedUser = await api.updateProfile({
        name: { first: 'Updated', last: 'Name' }
      });
      console.log('Profile updated via direct API call:', updatedUser);
      
      // Refresh server data to show the update
      await fetchServerData();
    } catch (err) {
      console.error('Direct API call failed:', err);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Loading...</h1>
          <p style={styles.subtitle}>Initializing authentication...</p>
        </div>
      </div>
    );
  }

  // Authentication error state
  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Authentication Error</h1>
          <p style={styles.error}>{error}</p>
          <button style={styles.button} onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Not authenticated state
  if (!isAuthenticated) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Zero-Config OxyHQ Services</h1>
          <p style={styles.subtitle}>
            Welcome! This demonstrates zero-config authentication.
          </p>
          
          <div style={styles.buttonContainer}>
            <button style={styles.button} onClick={handleLogin}>
              Login as Demo User
            </button>
            <button style={styles.buttonSecondary} onClick={handleRegister}>
              Register New User
            </button>
          </div>

          {publicData && (
            <div style={styles.dataCard}>
              <h3>Public Content (No Auth Required)</h3>
              <pre style={styles.codeBlock}>
                {JSON.stringify(publicData, null, 2)}
              </pre>
            </div>
          )}
          
          <div style={styles.infoBox}>
            <h3>How it works:</h3>
            <ul style={styles.list}>
              <li><strong>Frontend:</strong> Wrapped with <code>&lt;OxyZeroConfigProvider&gt;</code></li>
              <li><strong>Hook:</strong> Using <code>useOxyZeroConfig()</code> for auth state</li>
              <li><strong>Backend:</strong> Express middleware <code>createOxyAuth()</code> provides <code>req.user</code></li>
              <li><strong>Tokens:</strong> Automatically managed (saved/restored/refreshed)</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated state
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Welcome, {user.username}! 🎉</h1>
        <p style={styles.subtitle}>
          You're now authenticated with zero configuration!
        </p>

        <div style={styles.userInfo}>
          <h3>User Information</h3>
          <p><strong>Username:</strong> {user.username}</p>
          <p><strong>Email:</strong> {user.email}</p>
          <p><strong>User ID:</strong> {user.id}</p>
        </div>

        <div style={styles.buttonContainer}>
          <button style={styles.button} onClick={handleDirectApiCall}>
            Test Direct API Call
          </button>
          <button style={styles.button} onClick={fetchServerData}>
            Refresh Server Data
          </button>
          <button style={styles.buttonSecondary} onClick={logout}>
            Logout
          </button>
        </div>

        {loadingData && <p style={styles.loading}>Loading server data...</p>}

        {serverData && (
          <div style={styles.dataCard}>
            <h3>Protected Server Data</h3>
            <p>This data comes from a protected backend endpoint that automatically has access to <code>req.user</code></p>
            <pre style={styles.codeBlock}>
              {JSON.stringify(serverData, null, 2)}
            </pre>
          </div>
        )}

        {publicData && (
          <div style={styles.dataCard}>
            <h3>Public Content (Personalized)</h3>
            <p>This endpoint works with or without auth - since you're logged in, it shows personalized content</p>
            <pre style={styles.codeBlock}>
              {JSON.stringify(publicData, null, 2)}
            </pre>
          </div>
        )}

        <div style={styles.infoBox}>
          <h3>✨ Zero-Config Features Demonstrated:</h3>
          <ul style={styles.list}>
            <li>✅ Automatic token storage and restoration</li>
            <li>✅ Backend routes automatically have <code>req.user</code> available</li>
            <li>✅ Frontend automatically sends auth headers</li>
            <li>✅ Token refresh happens automatically in background</li>
            <li>✅ Error handling built-in</li>
            <li>✅ Cross-platform compatible</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// Styles
const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    minHeight: '100vh',
    padding: '20px'
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
    padding: '32px',
    maxWidth: '800px',
    width: '100%'
  },
  title: {
    color: '#333',
    marginBottom: '8px',
    textAlign: 'center'
  },
  subtitle: {
    color: '#666',
    textAlign: 'center',
    marginBottom: '24px'
  },
  userInfo: {
    backgroundColor: '#f8f9fa',
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '24px'
  },
  buttonContainer: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    marginBottom: '24px',
    flexWrap: 'wrap'
  },
  button: {
    backgroundColor: '#667eea',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    transition: 'all 0.2s',
    ':hover': {
      backgroundColor: '#5a6fd8'
    }
  },
  buttonSecondary: {
    backgroundColor: '#764ba2',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    transition: 'all 0.2s'
  },
  dataCard: {
    backgroundColor: '#f8f9fa',
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '16px'
  },
  codeBlock: {
    backgroundColor: '#2d3748',
    color: '#e2e8f0',
    padding: '12px',
    borderRadius: '4px',
    fontSize: '12px',
    overflow: 'auto',
    maxHeight: '300px'
  },
  infoBox: {
    backgroundColor: '#e8f4fd',
    border: '1px solid #bee3f8',
    borderRadius: '8px',
    padding: '16px',
    marginTop: '24px'
  },
  list: {
    paddingLeft: '20px',
    lineHeight: '1.6'
  },
  loading: {
    textAlign: 'center',
    color: '#666',
    fontStyle: 'italic'
  },
  error: {
    color: '#e53e3e',
    textAlign: 'center',
    marginBottom: '16px'
  }
};

export default Dashboard;