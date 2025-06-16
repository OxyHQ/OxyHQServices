# Integration Examples

Examples of integrating the Oxy API with different types of applications.

## Client Integration Examples

### JavaScript/TypeScript Client

```javascript
// Simple API client for any JavaScript application
class OxyApiClient {
  constructor(baseURL = 'http://localhost:3001') {
    this.baseURL = baseURL;
    this.accessToken = null;
    this.refreshToken = null;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}/api${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.accessToken && { Authorization: `Bearer ${this.accessToken}` }),
      ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    
    if (response.status === 401 && this.refreshToken) {
      // Try to refresh token
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        // Retry original request with new token
        headers.Authorization = `Bearer ${this.accessToken}`;
        return fetch(url, { ...options, headers });
      }
    }

    return response;
  }

  async login(username, password) {
    const response = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (response.ok) {
      const data = await response.json();
      this.accessToken = data.data.accessToken;
      this.refreshToken = data.data.refreshToken;
      return data.data;
    }

    throw new Error('Login failed');
  }

  async refreshAccessToken() {
    if (!this.refreshToken) return false;

    try {
      const response = await fetch(`${this.baseURL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken })
      });

      if (response.ok) {
        const data = await response.json();
        this.accessToken = data.data.accessToken;
        return true;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }

    return false;
  }

  async getCurrentUser() {
    const response = await this.request('/users/me');
    if (response.ok) {
      const data = await response.json();
      return data.data.user;
    }
    throw new Error('Failed to get user');
  }

  logout() {
    this.accessToken = null;
    this.refreshToken = null;
  }
}

// Usage
const client = new OxyApiClient();

async function example() {
  try {
    // Login
    await client.login('testuser', 'password123');
    console.log('Logged in successfully');

    // Get user data
    const user = await client.getCurrentUser();
    console.log('Current user:', user);

  } catch (error) {
    console.error('Error:', error);
  }
}
```

### React Hook for API Integration

```typescript
// hooks/useOxyApi.ts
import { useState, useEffect, useCallback } from 'react';

interface User {
  id: string;
  username: string;
  email: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export function useOxyApi(apiUrl = 'http://localhost:3001') {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true
  });

  const [accessToken, setAccessToken] = useState<string | null>(
    localStorage.getItem('oxy_access_token')
  );

  const apiRequest = useCallback(async (endpoint: string, options: RequestInit = {}) => {
    const url = `${apiUrl}/api${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json();
  }, [apiUrl, accessToken]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (response.ok) {
        const data = await response.json();
        const { accessToken: token, user } = data.data;
        
        setAccessToken(token);
        localStorage.setItem('oxy_access_token', token);
        
        setAuthState({
          user,
          isAuthenticated: true,
          isLoading: false
        });

        return { success: true, user };
      } else {
        throw new Error('Login failed');
      }
    } catch (error) {
      setAuthState(prev => ({ ...prev, isLoading: false }));
      return { success: false, error: error.message };
    }
  }, [apiUrl]);

  const logout = useCallback(() => {
    setAccessToken(null);
    localStorage.removeItem('oxy_access_token');
    setAuthState({
      user: null,
      isAuthenticated: false,
      isLoading: false
    });
  }, []);

  // Check existing token on mount
  useEffect(() => {
    const checkAuth = async () => {
      if (!accessToken) {
        setAuthState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      try {
        const data = await apiRequest('/auth/validate');
        if (data.data.valid) {
          setAuthState({
            user: data.data.user,
            isAuthenticated: true,
            isLoading: false
          });
        } else {
          logout();
        }
      } catch (error) {
        logout();
      }
    };

    checkAuth();
  }, [accessToken, apiRequest, logout]);

  return {
    ...authState,
    login,
    logout,
    apiRequest
  };
}

// Usage in React component
function App() {
  const { user, isAuthenticated, isLoading, login, logout } = useOxyApi();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      {isAuthenticated ? (
        <div>
          <h1>Welcome, {user?.username}!</h1>
          <button onClick={logout}>Logout</button>
        </div>
      ) : (
        <LoginForm onLogin={login} />
      )}
    </div>
  );
}
```

### Python Client Example

```python
# oxy_client.py
import requests
import json
from typing import Optional, Dict, Any

class OxyApiClient:
    def __init__(self, base_url: str = "http://localhost:3001"):
        self.base_url = base_url
        self.access_token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.session = requests.Session()

    def _request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        url = f"{self.base_url}/api{endpoint}"
        headers = kwargs.pop('headers', {})
        
        if self.access_token:
            headers['Authorization'] = f"Bearer {self.access_token}"
        
        headers['Content-Type'] = 'application/json'
        
        response = self.session.request(method, url, headers=headers, **kwargs)
        
        # Auto-refresh token on 401
        if response.status_code == 401 and self.refresh_token:
            if self._refresh_token():
                headers['Authorization'] = f"Bearer {self.access_token}"
                response = self.session.request(method, url, headers=headers, **kwargs)
        
        return response

    def login(self, username: str, password: str) -> Dict[str, Any]:
        response = self._request('POST', '/auth/login', 
                               json={'username': username, 'password': password})
        
        if response.status_code == 200:
            data = response.json()['data']
            self.access_token = data['accessToken']
            self.refresh_token = data['refreshToken']
            return data
        else:
            raise Exception(f"Login failed: {response.text}")

    def _refresh_token(self) -> bool:
        if not self.refresh_token:
            return False
        
        try:
            response = self.session.post(
                f"{self.base_url}/api/auth/refresh",
                headers={'Content-Type': 'application/json'},
                json={'refreshToken': self.refresh_token}
            )
            
            if response.status_code == 200:
                data = response.json()['data']
                self.access_token = data['accessToken']
                return True
        except Exception as e:
            print(f"Token refresh failed: {e}")
        
        return False

    def get_current_user(self) -> Dict[str, Any]:
        response = self._request('GET', '/users/me')
        if response.status_code == 200:
            return response.json()['data']['user']
        else:
            raise Exception(f"Failed to get user: {response.text}")

    def logout(self):
        if self.access_token:
            try:
                self._request('POST', '/auth/logout')
            except:
                pass  # Ignore errors during logout
        
        self.access_token = None
        self.refresh_token = None

# Usage example
if __name__ == "__main__":
    client = OxyApiClient()
    
    try:
        # Login
        login_result = client.login("testuser", "password123")
        print(f"Logged in as: {login_result['user']['username']}")
        
        # Get user data
        user = client.get_current_user()
        print(f"User email: {user['email']}")
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.logout()
```

### cURL Examples

```bash
#!/bin/bash
# test-api.sh - Script to test Oxy API endpoints

API_URL="http://localhost:3001/api"

echo "Testing Oxy API..."

# Register a new user
echo "1. Registering new user..."
REGISTER_RESPONSE=$(curl -s -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "password123"
  }')

echo "Register response: $REGISTER_RESPONSE"

# Login
echo -e "\n2. Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "password123"
  }')

echo "Login response: $LOGIN_RESPONSE"

# Extract access token
ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.data.accessToken')
echo "Access token: $ACCESS_TOKEN"

if [ "$ACCESS_TOKEN" != "null" ]; then
  # Get current user
  echo -e "\n3. Getting current user..."
  USER_RESPONSE=$(curl -s -X GET "$API_URL/users/me" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
  
  echo "User response: $USER_RESPONSE"

  # Validate token
  echo -e "\n4. Validating token..."
  VALIDATE_RESPONSE=$(curl -s -X GET "$API_URL/auth/validate" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
  
  echo "Validate response: $VALIDATE_RESPONSE"

  # Get sessions
  echo -e "\n5. Getting user sessions..."
  SESSIONS_RESPONSE=$(curl -s -X GET "$API_URL/secure-session/sessions" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
  
  echo "Sessions response: $SESSIONS_RESPONSE"

  # Logout
  echo -e "\n6. Logging out..."
  LOGOUT_RESPONSE=$(curl -s -X POST "$API_URL/auth/logout" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
  
  echo "Logout response: $LOGOUT_RESPONSE"
fi

echo -e "\nAPI test completed!"
```

### Node.js Express Integration

```javascript
// backend-integration.js
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const OXY_API_URL = 'http://localhost:3001';

// Middleware to validate tokens with Oxy API
async function validateOxyToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const response = await fetch(`${OXY_API_URL}/api/auth/validate`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.ok) {
      const data = await response.json();
      req.user = data.data.user;
      req.userId = data.data.user.id;
      next();
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Token validation failed' });
  }
}

// Protected route using Oxy API validation
app.get('/api/protected', validateOxyToken, (req, res) => {
  res.json({
    message: 'Access granted',
    user: req.user
  });
});

// Proxy login to Oxy API
app.post('/api/login', async (req, res) => {
  try {
    const response = await fetch(`${OXY_API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    
    if (response.ok) {
      // You can add additional logic here, like saving to your own database
      res.json(data);
    } else {
      res.status(response.status).json(data);
    }
  } catch (error) {
    res.status(500).json({ error: 'Login request failed' });
  }
});

app.listen(4000, () => {
  console.log('Backend server running on port 4000');
});
```

These examples show various ways to integrate with the Oxy API from different platforms and programming languages, including token management, error handling, and session management.
