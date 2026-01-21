/**
 * Complete React Example: Cross-Domain Auth with Oxy
 *
 * This example shows how to implement Google-style SSO in a React app.
 * Users sign in once and are automatically authenticated across all Oxy apps.
 */

import React, { useEffect, useState, createContext, useContext } from 'react';
import { OxyServices, createCrossDomainAuth, type CrossDomainAuth } from '@oxyhq/services';
import type { User } from '@oxyhq/services';

// ==================== 1. Setup ====================

const oxyServices = new OxyServices({
  baseURL: 'https://api.oxy.so',
  cloudURL: 'https://cloud.oxy.so',
});

const auth = createCrossDomainAuth(oxyServices);

// ==================== 2. Auth Context ====================

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  crossDomainAuth: CrossDomainAuth;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initialize auth on mount
    const initializeAuth = async () => {
      try {
        // This handles:
        // 1. Redirect callbacks
        // 2. Stored sessions
        // 3. Silent SSO check
        const session = await auth.initialize();

        if (session) {
          setUser(session.user);
          console.log('User authenticated via SSO:', session.user.username);
        }
      } catch (error) {
        console.error('Auth initialization failed:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const signIn = async () => {
    setLoading(true);
    try {
      // Auto-selects best method: FedCM → Popup → Redirect
      const session = await auth.signIn({
        method: 'auto',
        onMethodSelected: (method) => {
          console.log(`Authenticating with: ${method}`);
        },
      });

      if (session) {
        setUser(session.user);
      }
    } catch (error) {
      console.error('Sign in failed:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
      const sessionId = (oxyServices as any).getStoredSessionId?.();
      if (sessionId) {
        await oxyServices.logoutSession(sessionId);
      }

      // Clear stored session
      (oxyServices as any).clearStoredSession?.();

      setUser(null);
    } catch (error) {
      console.error('Sign out failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, crossDomainAuth: auth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// ==================== 3. Components ====================

function LoginPage() {
  const { signIn, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    try {
      setError(null);
      await signIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    }
  };

  return (
    <div className="login-page">
      <h1>Welcome to Oxy</h1>
      <p>Sign in once, access all Oxy apps</p>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      <button onClick={handleSignIn} disabled={loading}>
        {loading ? 'Signing in...' : 'Sign in with Oxy'}
      </button>

      <p className="hint">
        Works across homiio.com, mention.earth, alia.onl, and all Oxy apps
      </p>
    </div>
  );
}

function Dashboard() {
  const { user, signOut, loading } = useAuth();

  if (!user) return null;

  return (
    <div className="dashboard">
      <header>
        <div className="user-info">
          <img
            src={user.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`}
            alt={user.username}
            className="avatar"
          />
          <div>
            <h2>{user.username}</h2>
            <p>{user.email}</p>
          </div>
        </div>

        <button onClick={signOut} disabled={loading}>
          {loading ? 'Signing out...' : 'Sign Out'}
        </button>
      </header>

      <main>
        <h3>You're signed in!</h3>
        <p>
          Open any other Oxy app (homiio.com, mention.earth, etc.) and you'll be
          automatically signed in. No need to sign in again!
        </p>

        <div className="sso-status">
          <h4>SSO Status</h4>
          <ul>
            <li>✅ Authenticated across all Oxy domains</li>
            <li>✅ No third-party cookies required</li>
            <li>✅ Privacy-preserving identity</li>
          </ul>
        </div>
      </main>
    </div>
  );
}

// ==================== 4. Main App ====================

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  return user ? <Dashboard /> : <LoginPage />;
}

// ==================== 5. Advanced: Method Selection ====================

function AdvancedAuthExample() {
  const { crossDomainAuth } = useAuth();

  const handleFedCMOnly = async () => {
    try {
      const session = await crossDomainAuth.signInWithFedCM();
      console.log('Signed in with FedCM:', session.user);
    } catch (error) {
      console.error('FedCM not supported, try popup:', error);
    }
  };

  const handlePopupOnly = async () => {
    const session = await crossDomainAuth.signInWithPopup({
      popupDimensions: { width: 600, height: 800 },
    });
    console.log('Signed in with popup:', session.user);
  };

  const handleRedirectOnly = () => {
    crossDomainAuth.signInWithRedirect({
      redirectUri: window.location.href,
    });
    // Will navigate away
  };

  const handleSilentSignIn = async () => {
    const session = await crossDomainAuth.silentSignIn();
    if (session) {
      console.log('Silent sign-in successful:', session.user);
    } else {
      console.log('No existing session found');
    }
  };

  const checkMethod = () => {
    const { method, reason } = crossDomainAuth.getRecommendedMethod();
    console.log(`Recommended: ${method} - ${reason}`);
  };

  return (
    <div>
      <h3>Advanced Auth Methods</h3>
      <button onClick={handleFedCMOnly}>Sign in with FedCM (Chrome 108+)</button>
      <button onClick={handlePopupOnly}>Sign in with Popup</button>
      <button onClick={handleRedirectOnly}>Sign in with Redirect</button>
      <button onClick={handleSilentSignIn}>Try Silent Sign-in</button>
      <button onClick={checkMethod}>Check Recommended Method</button>
    </div>
  );
}

// ==================== 6. Hooks ====================

/**
 * Custom hook for current user data
 */
export function useCurrentUser() {
  const { user } = useAuth();
  return user;
}

/**
 * Custom hook for authentication state
 */
export function useAuthState() {
  const { user, loading } = useAuth();
  return {
    isAuthenticated: !!user,
    isLoading: loading,
    user,
  };
}

/**
 * Custom hook for protected routes
 */
export function useRequireAuth() {
  const { user, loading, signIn } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      signIn();
    }
  }, [loading, user, signIn]);

  return { user, loading };
}

// Usage in component:
function ProtectedPage() {
  const { user, loading } = useRequireAuth();

  if (loading) return <div>Loading...</div>;
  if (!user) return null; // Will trigger sign-in

  return <div>Protected content for {user.username}</div>;
}
