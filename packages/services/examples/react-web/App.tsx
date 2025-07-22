/**
 * Zero-Config Authentication Example - React Web App
 * 
 * This example demonstrates how to set up OxyHQ Services authentication
 * in a React web application with minimal configuration.
 */

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth, useAuthStatus } from '@oxyhq/services';

// =============================================================================
// MAIN APP COMPONENT
// =============================================================================

function App() {
  return (
    <AuthProvider baseURL="http://localhost:3001">
      <BrowserRouter>
        <div className="app">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            } />
            <Route path="/profile" element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            } />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

// =============================================================================
// ROUTE PROTECTION COMPONENT
// =============================================================================

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStatus();
  
  if (isLoading) {
    return <LoadingSpinner />;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  return <>{children}</>;
}

// =============================================================================
// PAGE COMPONENTS
// =============================================================================

function HomePage() {
  const { isAuthenticated, user } = useAuth();
  
  return (
    <div className="page">
      <NavBar />
      <main className="main">
        <h1>Welcome to OxyHQ Services Example</h1>
        {isAuthenticated ? (
          <div>
            <p>Hello, {user?.username}! 👋</p>
            <p>You are successfully authenticated with zero configuration!</p>
            <div className="buttons">
              <a href="/dashboard" className="button primary">Go to Dashboard</a>
              <a href="/profile" className="button">View Profile</a>
            </div>
          </div>
        ) : (
          <div>
            <p>This example demonstrates zero-config authentication with OxyHQ Services.</p>
            <div className="buttons">
              <a href="/login" className="button primary">Sign In</a>
              <a href="/register" className="button">Sign Up</a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function LoginPage() {
  const { login, error, clearError, isLoading } = useAuth();
  const [formData, setFormData] = useState({ username: '', password: '' });
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      clearError();
      await login(formData.username, formData.password);
      // Navigation happens automatically via auth state change
    } catch (err) {
      // Error is automatically set in auth state
      console.error('Login failed:', err);
    }
  };
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };
  
  return (
    <div className="page">
      <NavBar />
      <main className="main">
        <div className="auth-form">
          <h1>Sign In</h1>
          {error && (
            <div className="error-alert">
              {error}
              <button onClick={clearError} className="error-close">×</button>
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="username">Username or Email</label>
              <input
                id="username"
                name="username"
                type="text"
                value={formData.username}
                onChange={handleChange}
                required
                disabled={isLoading}
                placeholder="Enter your username"
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                required
                disabled={isLoading}
                placeholder="Enter your password"
              />
            </div>
            <button 
              type="submit" 
              className="button primary full-width"
              disabled={isLoading}
            >
              {isLoading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>
          <p className="auth-link">
            Don't have an account? <a href="/register">Sign up</a>
          </p>
        </div>
      </main>
    </div>
  );
}

function RegisterPage() {
  const { register, checkUsernameAvailability, checkEmailAvailability, error, clearError, isLoading } = useAuth();
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [validation, setValidation] = useState({
    username: null as boolean | null,
    email: null as boolean | null,
    passwordMatch: true
  });
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.password !== formData.confirmPassword) {
      setValidation(prev => ({ ...prev, passwordMatch: false }));
      return;
    }
    
    try {
      clearError();
      await register(formData.username, formData.email, formData.password);
      // Navigation happens automatically via auth state change
    } catch (err) {
      console.error('Registration failed:', err);
    }
  };
  
  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Real-time validation
    if (name === 'username' && value.length >= 3) {
      const result = await checkUsernameAvailability(value);
      setValidation(prev => ({ ...prev, username: result.available }));
    } else if (name === 'email' && value.includes('@')) {
      const result = await checkEmailAvailability(value);
      setValidation(prev => ({ ...prev, email: result.available }));
    } else if (name === 'confirmPassword' || name === 'password') {
      setValidation(prev => ({ 
        ...prev, 
        passwordMatch: name === 'confirmPassword' 
          ? value === formData.password 
          : value === formData.confirmPassword 
      }));
    }
  };
  
  return (
    <div className="page">
      <NavBar />
      <main className="main">
        <div className="auth-form">
          <h1>Sign Up</h1>
          {error && (
            <div className="error-alert">
              {error}
              <button onClick={clearError} className="error-close">×</button>
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                name="username"
                type="text"
                value={formData.username}
                onChange={handleChange}
                required
                disabled={isLoading}
                placeholder="Choose a username"
                className={validation.username === false ? 'invalid' : ''}
              />
              {validation.username === false && (
                <span className="field-error">Username is already taken</span>
              )}
              {validation.username === true && (
                <span className="field-success">Username is available</span>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                required
                disabled={isLoading}
                placeholder="Enter your email"
                className={validation.email === false ? 'invalid' : ''}
              />
              {validation.email === false && (
                <span className="field-error">Email is already registered</span>
              )}
              {validation.email === true && (
                <span className="field-success">Email is available</span>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                required
                disabled={isLoading}
                placeholder="Create a password"
                minLength={6}
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                disabled={isLoading}
                placeholder="Confirm your password"
                className={!validation.passwordMatch ? 'invalid' : ''}
              />
              {!validation.passwordMatch && (
                <span className="field-error">Passwords do not match</span>
              )}
            </div>
            <button 
              type="submit" 
              className="button primary full-width"
              disabled={isLoading || validation.username === false || validation.email === false || !validation.passwordMatch}
            >
              {isLoading ? 'Creating Account...' : 'Sign Up'}
            </button>
          </form>
          <p className="auth-link">
            Already have an account? <a href="/login">Sign in</a>
          </p>
        </div>
      </main>
    </div>
  );
}

function DashboardPage() {
  const { user, getCurrentUser } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await getCurrentUser();
    } catch (error) {
      console.error('Failed to refresh user data:', error);
    } finally {
      setRefreshing(false);
    }
  };
  
  return (
    <div className="page">
      <NavBar />
      <main className="main">
        <div className="dashboard">
          <div className="dashboard-header">
            <h1>Dashboard</h1>
            <button 
              onClick={handleRefresh} 
              className="button secondary"
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing...' : 'Refresh Data'}
            </button>
          </div>
          
          <div className="cards">
            <div className="card">
              <h3>Welcome Back!</h3>
              <p>Hello, {user?.username}! Here's your personalized dashboard.</p>
            </div>
            
            <div className="card">
              <h3>Account Status</h3>
              <p>✅ Authentication: Active</p>
              <p>✅ Profile: Complete</p>
              <p>✅ Session: Valid</p>
            </div>
            
            <div className="card">
              <h3>Quick Actions</h3>
              <div className="buttons">
                <a href="/profile" className="button primary">Edit Profile</a>
                <button className="button secondary">Settings</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ProfilePage() {
  const { user, logout } = useAuth();
  
  const handleLogout = async () => {
    try {
      await logout();
      // Navigation happens automatically
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };
  
  return (
    <div className="page">
      <NavBar />
      <main className="main">
        <div className="profile">
          <h1>Profile</h1>
          <div className="profile-card">
            <div className="profile-info">
              <h2>{user?.username}</h2>
              <p>{user?.email}</p>
              <p className="user-id">ID: {user?.id}</p>
            </div>
            <div className="profile-actions">
              <button className="button secondary">Edit Profile</button>
              <button onClick={handleLogout} className="button danger">
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// =============================================================================
// NAVIGATION COMPONENT
// =============================================================================

function NavBar() {
  const { isAuthenticated, user, logout } = useAuth();
  
  return (
    <nav className="navbar">
      <div className="nav-brand">
        <a href="/">OxyHQ Example</a>
      </div>
      <div className="nav-menu">
        {isAuthenticated ? (
          <>
            <a href="/dashboard" className="nav-link">Dashboard</a>
            <a href="/profile" className="nav-link">Profile</a>
            <span className="nav-user">Welcome, {user?.username}</span>
            <button onClick={logout} className="button small">Logout</button>
          </>
        ) : (
          <>
            <a href="/login" className="nav-link">Sign In</a>
            <a href="/register" className="button small primary">Sign Up</a>
          </>
        )}
      </div>
    </nav>
  );
}

// =============================================================================
// UTILITY COMPONENTS
// =============================================================================

function LoadingSpinner() {
  return (
    <div className="loading-spinner">
      <div className="spinner"></div>
      <p>Loading...</p>
    </div>
  );
}

// =============================================================================
// APP INITIALIZATION
// =============================================================================

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);