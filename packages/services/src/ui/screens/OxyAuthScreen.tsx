/**
 * OxyAuthScreen - Sign in with Oxy
 * 
 * This screen is used by OTHER apps in the Oxy ecosystem to authenticate users.
 * It presents two options:
 * 1. Scan QR code with Oxy Accounts app
 * 2. Open the Oxy Auth web flow
 * 
 * Uses WebSocket for real-time authorization updates (with polling fallback).
 * The Oxy Accounts app is where users manage their cryptographic identity.
 * This screen should NOT be used within the Accounts app itself.
 */

import type React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
  ActivityIndicator,
} from 'react-native';
import io, { type Socket } from 'socket.io-client';
import type { BaseScreenProps } from '../types/navigation';
import { useThemeColors } from '../styles';
import { useOxy } from '../context/OxyContext';
import QRCode from 'react-native-qrcode-svg';
import OxyLogo from '../components/OxyLogo';
import { createDebugLogger } from '../../shared/utils/debugUtils';

const debug = createDebugLogger('OxyAuthScreen');

const OXY_ACCOUNTS_WEB_URL = 'https://accounts.oxy.so';
const OXY_AUTH_WEB_URL = 'https://auth.oxy.so';

// Auth session expiration (5 minutes)
const AUTH_SESSION_EXPIRY_MS = 5 * 60 * 1000;

// Polling interval (fallback if socket fails)
const POLLING_INTERVAL_MS = 3000;

interface AuthSession {
  sessionToken: string;
  expiresAt: number;
}

interface AuthUpdatePayload {
  status: 'authorized' | 'cancelled' | 'expired';
  sessionId?: string;
  publicKey?: string;
  userId?: string;
  username?: string;
}

const resolveAuthWebBaseUrl = (baseURL: string, authWebUrl?: string): string => {
  if (authWebUrl) {
    return authWebUrl;
  }

  try {
    const url = new URL(baseURL);
    if (url.port === '3001') {
      url.port = '3000';
      return url.origin;
    }
    if (url.hostname.startsWith('api.')) {
      url.hostname = `auth.${url.hostname.slice(4)}`;
      return url.origin;
    }
  } catch {
    // Ignore parsing errors, fall back to default.
  }
  return OXY_AUTH_WEB_URL;
};

const resolveAuthRedirectUri = async (authRedirectUri?: string): Promise<string | null> => {
  if (authRedirectUri) {
    return authRedirectUri;
  }

  try {
    const initialUrl = await Linking.getInitialURL();
    if (!initialUrl) {
      return null;
    }

    const parsed = new URL(initialUrl);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
};

const getRedirectParams = (url: string): { sessionId?: string; error?: string } | null => {
  try {
    const parsed = new URL(url);
    const sessionId = parsed.searchParams.get('session_id') ?? undefined;
    const error = parsed.searchParams.get('error') ?? undefined;

    if (!sessionId && !error) {
      return null;
    }

    return { sessionId, error };
  } catch {
    return null;
  }
};

const OxyAuthScreen: React.FC<BaseScreenProps> = ({
  navigate,
  goBack,
  onAuthenticated,
  theme,
}) => {
  const themeValue = (theme === 'light' || theme === 'dark') ? theme : 'light';
  const colors = useThemeColors(themeValue);
  const { oxyServices, signIn, switchSession } = useOxy();

  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [connectionType, setConnectionType] = useState<'socket' | 'polling'>('socket');

  const socketRef = useRef<Socket | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isProcessingRef = useRef(false);
  const linkingHandledRef = useRef(false);

  // Handle successful authorization
  const handleAuthSuccess = useCallback(async (sessionId: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      // Switch to the new session (this will get token, user data, and update state)
      if (switchSession) {
        const user = await switchSession(sessionId);
        if (onAuthenticated) {
          onAuthenticated(user);
        }
      } else {
        // Fallback if switchSession not available (shouldn't happen, but for safety)
        await oxyServices.getTokenBySession(sessionId);
        const user = await oxyServices.getUserBySession(sessionId);
        if (onAuthenticated) {
          onAuthenticated(user);
        }
      }
    } catch (err) {
      debug.error('Error completing auth:', err);
      setError('Authorization successful but failed to complete sign in. Please try again.');
      isProcessingRef.current = false;
    }
  }, [oxyServices, switchSession, onAuthenticated]);

  // Connect to socket for real-time updates
  const connectSocket = useCallback((sessionToken: string) => {
    const baseURL = oxyServices.getBaseURL();

    // Connect to the auth-session namespace (no authentication required)
    const socket = io(`${baseURL}/auth-session`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      debug.log('Auth socket connected');
      // Join the room for this session token
      socket.emit('join', sessionToken);
      setConnectionType('socket');
    });

    socket.on('joined', () => {
      debug.log('Joined auth session room');
    });

    socket.on('auth_update', (payload: AuthUpdatePayload) => {
      debug.log('Auth update received:', payload);

      if (payload.status === 'authorized' && payload.sessionId) {
        cleanup();
        handleAuthSuccess(payload.sessionId);
      } else if (payload.status === 'cancelled') {
        cleanup();
        setError('Authorization was denied.');
      } else if (payload.status === 'expired') {
        cleanup();
        setError('Session expired. Please try again.');
      }
    });

    socket.on('connect_error', (err) => {
      debug.log('Socket connection error, falling back to polling:', err.message);
      // Fall back to polling if socket fails
      socket.disconnect();
      startPolling(sessionToken);
    });

    socket.on('disconnect', () => {
      debug.log('Auth socket disconnected');
    });
  }, [oxyServices, handleAuthSuccess]);

  // Start polling for authorization (fallback)
  const startPolling = useCallback((sessionToken: string) => {
    setConnectionType('polling');

    pollingIntervalRef.current = setInterval(async () => {
      if (isProcessingRef.current) return;

      try {
        const response: {
          authorized: boolean;
          sessionId?: string;
          publicKey?: string;
          status?: string;
        } = await oxyServices.makeRequest('GET', `/api/auth/session/status/${sessionToken}`, undefined, { cache: false });

        if (response.authorized && response.sessionId) {
          cleanup();
          handleAuthSuccess(response.sessionId);
        } else if (response.status === 'cancelled') {
          cleanup();
          setError('Authorization was denied.');
        } else if (response.status === 'expired') {
          cleanup();
          setError('Session expired. Please try again.');
        }
      } catch (err) {
        // Silent fail for polling - will retry
        debug.log('Auth polling error:', err);
      }
    }, POLLING_INTERVAL_MS);
  }, [oxyServices, handleAuthSuccess]);

  // Cleanup socket and polling
  const cleanup = useCallback(() => {
    setIsWaiting(false);

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Generate a new auth session
  const generateAuthSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    isProcessingRef.current = false;

    try {
      // Generate a unique session token for this auth request
      const sessionToken = generateSessionToken();
      const expiresAt = Date.now() + AUTH_SESSION_EXPIRY_MS;

      // Register the auth session with the server
      await oxyServices.makeRequest('POST', '/api/auth/session/create', {
        sessionToken,
        expiresAt,
        appId: Platform.OS, // Identifier for requesting app
      }, { cache: false });

      setAuthSession({ sessionToken, expiresAt });
      setIsWaiting(true);

      // Try socket first, will fall back to polling if needed
      connectSocket(sessionToken);
    } catch (err: any) {
      setError(err.message || 'Failed to create auth session');
    } finally {
      setIsLoading(false);
    }
  }, [oxyServices, connectSocket]);

  // Generate a random session token
  const generateSessionToken = (): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Initialize auth session
  useEffect(() => {
    generateAuthSession();
  }, []);

  // Check if session expired
  useEffect(() => {
    if (authSession && Date.now() > authSession.expiresAt) {
      cleanup();
      setAuthSession(null);
      setError('Session expired. Please try again.');
    }
  }, [authSession, cleanup]);

  // Build the QR code data
  const getQRData = (): string => {
    if (!authSession) return '';

    // Format: oxyauth://{sessionToken}
    return `oxyauth://${authSession.sessionToken}`;
  };

  // Open Oxy Auth web flow
  const handleOpenAuth = useCallback(async () => {
    if (!authSession) return;

    const authBaseUrl = resolveAuthWebBaseUrl(
      oxyServices.getBaseURL(),
      oxyServices.config?.authWebUrl
    );
    const webUrl = new URL('/authorize', authBaseUrl);
    webUrl.searchParams.set('token', authSession.sessionToken);
    const redirectUri = await resolveAuthRedirectUri(oxyServices.config?.authRedirectUri);
    if (redirectUri) {
      webUrl.searchParams.set('redirect_uri', redirectUri);
    }

    try {
      await Linking.openURL(webUrl.toString());
    } catch (err) {
      setError('Unable to open Oxy Auth. Please try again or use the QR code.');
    }
  }, [authSession, oxyServices]);

  // Refresh session
  const handleRefresh = useCallback(() => {
    cleanup();
    generateAuthSession();
  }, [generateAuthSession, cleanup]);

  const handleAuthRedirect = useCallback((url: string) => {
    const params = getRedirectParams(url);
    if (!params) {
      return;
    }

    if (params.error) {
      cleanup();
      setError('Authorization was denied.');
      return;
    }

    if (params.sessionId) {
      cleanup();
      handleAuthSuccess(params.sessionId);
    }
  }, [cleanup, handleAuthSuccess]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    const subscription = Linking.addEventListener('url', ({ url }) => {
      linkingHandledRef.current = true;
      handleAuthRedirect(url);
    });

    Linking.getInitialURL()
      .then((url) => {
        if (url && !linkingHandledRef.current) {
          handleAuthRedirect(url);
        }
      })
      .catch(() => {
        // Ignore linking errors; auth will still resolve via socket/polling.
      });

    return () => {
      subscription.remove();
    };
  }, [handleAuthRedirect]);

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.secondaryText }]}>
          Preparing sign in...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={handleRefresh}
        >
          <Text style={styles.buttonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <OxyLogo width={48} height={48} />
        <Text style={[styles.title, { color: colors.text }]}>Sign in with Oxy</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
          Use your Oxy identity to sign in securely
        </Text>
      </View>

      {/* QR Code */}
      <View style={[styles.qrContainer, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
        <View style={styles.qrWrapper}>
          <QRCode
            value={getQRData()}
            size={200}
            backgroundColor="white"
            color="black"
          />
        </View>
        <Text style={[styles.qrHint, { color: colors.secondaryText }]}>
          Scan with Oxy Accounts app
        </Text>
      </View>

      {/* Divider */}
      <View style={styles.dividerContainer}>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Text style={[styles.dividerText, { color: colors.secondaryText }]}>or</Text>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
      </View>

      {/* Open Oxy Auth Button */}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={handleOpenAuth}
      >
        <OxyLogo width={20} height={20} fillColor="white" style={styles.buttonIcon} />
        <Text style={styles.buttonText}>Open Oxy Auth</Text>
      </TouchableOpacity>

      {/* Status */}
      {isWaiting && (
        <View style={styles.statusContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.statusText, { color: colors.secondaryText }]}>
            Waiting for authorization...
          </Text>
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.secondaryText }]}>
          Don't have Oxy Accounts?{' '}
        </Text>
        <TouchableOpacity onPress={() => Linking.openURL(OXY_ACCOUNTS_WEB_URL)}>
          <Text style={[styles.footerLink, { color: colors.primary }]}>
            Get it here
          </Text>
        </TouchableOpacity>
      </View>

      {/* Cancel Button */}
      {goBack && (
        <TouchableOpacity style={styles.cancelButton} onPress={goBack}>
          <Text style={[styles.cancelText, { color: colors.secondaryText }]}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  qrContainer: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: 'white',
    borderRadius: 12,
  },
  qrHint: {
    marginTop: 16,
    fontSize: 12,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
    width: '100%',
  },
  divider: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 16,
    fontSize: 14,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
  },
  buttonIcon: {
    marginRight: 10,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
  },
  statusText: {
    marginLeft: 8,
    fontSize: 14,
  },
  footer: {
    flexDirection: 'row',
    marginTop: 32,
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: '600',
  },
  cancelButton: {
    marginTop: 16,
    padding: 12,
  },
  cancelText: {
    fontSize: 14,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
});

export default OxyAuthScreen;
