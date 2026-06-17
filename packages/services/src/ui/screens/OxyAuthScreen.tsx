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
} from 'react-native';
import io, { type Socket } from 'socket.io-client';
import type { BaseScreenProps } from '../types/navigation';
import { useTheme } from '@oxyhq/bloom/theme';
import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { useOxy } from '../context/OxyContext';
import QRCode from 'react-native-qrcode-svg';
import OxyLogo from '../components/OxyLogo';
import { createDebugLogger } from '@oxyhq/core';
import { completeDeviceFlowSignIn } from '../../utils/deviceFlowSignIn';

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
      url.port = '3002';
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
  const bloomTheme = useTheme();
  const { oxyServices, switchSession, clientId } = useOxy();

  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [connectionType, setConnectionType] = useState<'socket' | 'polling'>('socket');

  const socketRef = useRef<Socket | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isProcessingRef = useRef(false);
  const linkingHandledRef = useRef(false);

  // Handle successful authorization.
  //
  // The auth-session socket / poll (or deep-link return) hands us the
  // authorized `sessionId`. Before any session-management code can touch it we
  // MUST first exchange the secret `sessionToken` (held only by this client,
  // generated for THIS flow) for the first access token via
  // `claimSessionByToken` — the device-flow equivalent of OAuth's
  // code-for-token exchange (RFC 8628 §3.4).
  //
  // Without that exchange the SDK has no bearer token — the session is
  // authorized server-side but the app never becomes authenticated and the
  // sheet sits "Waiting for authorization..." forever. Once
  // `claimSessionByToken` plants the tokens in the HttpService, the rest of the
  // session wiring flows through the normal `switchSession` path. This mirrors
  // `SignInModal`'s web flow exactly.
  const handleAuthSuccess = useCallback(async (sessionId: string, sessionToken: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      // Claim the first access token with the secret sessionToken, then
      // hydrate the session. The claim step is what the native screen was
      // previously missing — see `completeDeviceFlowSignIn`. `switchSession`
      // is always provided by the context here; the helper requires it.
      if (!switchSession) {
        throw new Error('Session management unavailable');
      }
      const user = await completeDeviceFlowSignIn({
        oxyServices,
        sessionId,
        sessionToken,
        switchSession,
      });
      if (onAuthenticated) {
        onAuthenticated(user);
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
        // `sessionToken` is this flow's secret credential (in closure) — pass
        // it through so `handleAuthSuccess` can claim the first access token.
        handleAuthSuccess(payload.sessionId, sessionToken);
      } else if (payload.status === 'cancelled') {
        cleanup();
        setError('Authorization was denied.');
      } else if (payload.status === 'expired') {
        cleanup();
        setError('Session expired. Please try again.');
      }
    });

    socket.on('connect_error', (err) => {
      debug.log('Socket connection error, falling back to polling:', (err instanceof Error ? err.message : null));
      // Realtime transport errored — reflect the honest connection state. The
      // poll is already running (started unconditionally in
      // `generateAuthSession`), so `startPolling` here is a no-op backstop.
      socket.disconnect();
      setConnectionType('polling');
      startPolling(sessionToken);
    });

    socket.on('disconnect', () => {
      debug.log('Auth socket disconnected');
    });
  }, [oxyServices, handleAuthSuccess]);

  // Start polling for authorization.
  //
  // Idempotent: if a poll interval is already running this is a no-op, so the
  // `connect_error` path (which also calls this) cannot stack a second interval
  // on top of the always-on poll started in `generateAuthSession`.
  const startPolling = useCallback((sessionToken: string) => {
    if (pollingIntervalRef.current) return;

    pollingIntervalRef.current = setInterval(async () => {
      if (isProcessingRef.current) return;

      try {
        const response: {
          authorized: boolean;
          sessionId?: string;
          publicKey?: string;
          status?: string;
        } = await oxyServices.makeRequest('GET', `/auth/session/status/${sessionToken}`, undefined, { cache: false });

        if (response.authorized && response.sessionId) {
          cleanup();
          // Pass the original sessionToken (in closure) through; the claim
          // exchange needs it to mint the first access token.
          handleAuthSuccess(response.sessionId, sessionToken);
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

    // The cross-app device sign-in flow identifies the requesting app by its
    // real registered OAuth client id (ApplicationCredential publicKey).
    // Without it the API cannot resolve the consent identity, so we fail fast
    // with a clear configuration error rather than creating a session the
    // server would reject.
    if (!clientId) {
      setError('This app is not configured for sign-in (missing clientId).');
      setIsLoading(false);
      return;
    }

    try {
      // Generate a unique session token for this auth request
      const sessionToken = generateSessionToken();
      const expiresAt = Date.now() + AUTH_SESSION_EXPIRY_MS;

      // Register the auth session with the server
      await oxyServices.makeRequest('POST', '/auth/session/create', {
        sessionToken,
        expiresAt,
        clientId,
      }, { cache: false });

      setAuthSession({ sessionToken, expiresAt });
      setIsWaiting(true);

      // Socket is the fast path; the poll is a transport-independent backstop
      // that guarantees completion even if the socket connects but silently
      // never delivers auth_update (RN transport / idle-timeout).
      connectSocket(sessionToken);
      startPolling(sessionToken);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : null) || 'Failed to create auth session');
    } finally {
      setIsLoading(false);
    }
  }, [oxyServices, connectSocket, startPolling, clientId]);

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
      // The deep-link return carries only `session_id` — the secret
      // `sessionToken` for this flow lives in component state (generated in
      // `generateAuthSession`). Without it we cannot claim the first access
      // token, so the flow would 401 in `handleAuthSuccess`. If it is somehow
      // unavailable, fall through to the socket/poll path (which carries the
      // token in closure) rather than attempting an unauthenticated claim.
      const flowSessionToken = authSession?.sessionToken;
      if (!flowSessionToken) {
        return;
      }
      cleanup();
      handleAuthSuccess(params.sessionId, flowSessionToken);
    }
  }, [authSession, cleanup, handleAuthSuccess]);

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
      <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
        <Loading size="large" />
        <Text style={styles.loadingText} className="text-muted-foreground">
          Preparing sign in...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
        <Text style={styles.errorText} className="text-destructive">{error}</Text>
        <Button variant="primary" onPress={handleRefresh} style={{ width: '100%', borderRadius: 12 }}>
          Try Again
        </Button>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <OxyLogo variant="icon" size={48} />
        <Text style={styles.title} className="text-foreground">Sign in with Oxy</Text>
        <Text style={styles.subtitle} className="text-muted-foreground">
          Use your Oxy identity to sign in securely
        </Text>
      </View>

      {/* QR Code */}
      <View style={styles.qrContainer} className="bg-secondary border-border">
        <View style={styles.qrWrapper}>
          <QRCode
            value={getQRData()}
            size={200}
            backgroundColor="white"
            color="black"
          />
        </View>
        <Text style={styles.qrHint} className="text-muted-foreground">
          Scan with Oxy Accounts app
        </Text>
      </View>

      {/* Divider */}
      <View style={styles.dividerContainer}>
        <View style={styles.divider} className="bg-border" />
        <Text style={styles.dividerText} className="text-muted-foreground">or</Text>
        <View style={styles.divider} className="bg-border" />
      </View>

      {/* Open Oxy Auth Button */}
      <Button
        variant="primary"
        onPress={handleOpenAuth}
        icon={<OxyLogo variant="icon" size={20} fillColor={bloomTheme.colors.card} style={styles.buttonIcon} />}
        style={{ width: '100%', borderRadius: 12 }}
      >
        Open Oxy Auth
      </Button>

      {/* Status */}
      {isWaiting && (
        <View style={styles.statusContainer}>
          <Loading size="small" style={{ flex: undefined }} />
          <Text style={styles.statusText} className="text-muted-foreground">
            Waiting for authorization...
          </Text>
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText} className="text-muted-foreground">
          Don't have Oxy Accounts?{' '}
        </Text>
        <TouchableOpacity onPress={() => Linking.openURL(OXY_ACCOUNTS_WEB_URL)}>
          <Text style={styles.footerLink} className="text-primary">
            Get it here
          </Text>
        </TouchableOpacity>
      </View>

      {/* Cancel Button */}
      {goBack && (
        <TouchableOpacity style={styles.cancelButton} onPress={goBack}>
          <Text style={styles.cancelText} className="text-muted-foreground">Cancel</Text>
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
  buttonIcon: {
    marginRight: 10,
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
