import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { jwtDecode } from 'jwt-decode';
import { OxyConfig, ApiError, User } from '../models/interfaces';
import { handleHttpError } from '../utils/errorUtils';

interface JwtPayload {
  exp?: number;
  userId?: string;
  id?: string;
  [key: string]: any;
}

/**
 * OxyServices - Base client library for interacting with the Oxy API
 * 
 * This class provides the core HTTP client setup, token management, and error handling.
 * Specific functionality is delegated to focused service modules.
 */
// Centralized token store
class TokenStore {
  private static instance: TokenStore;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  private constructor() {}

  static getInstance(): TokenStore {
    if (!TokenStore.instance) {
      TokenStore.instance = new TokenStore();
    }
    return TokenStore.instance;
  }

  setTokens(accessToken: string, refreshToken: string = ''): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }

  hasAccessToken(): boolean {
    return !!this.accessToken;
  }
}

export class OxyServices {
  protected client: AxiosInstance;
  private tokenStore: TokenStore;

  /**
   * Creates a new instance of the OxyServices client
   * @param config - Configuration for the client
   */
  constructor(config: OxyConfig) {
    this.client = axios.create({ 
      baseURL: config.baseURL,
      timeout: 10000 // 10 second timeout
    });
    
    this.tokenStore = TokenStore.getInstance();
    this.setupInterceptors();
  }

  /**
   * Setup axios interceptors for authentication and error handling
   */
  private setupInterceptors(): void {
    // Request interceptor for adding auth header and handling token refresh
    this.client.interceptors.request.use(async (req: InternalAxiosRequestConfig) => {
      console.log('🔍 Interceptor - URL:', req.url);
      console.log('🔍 Interceptor - Has token:', this.tokenStore.hasAccessToken());
      
      if (!this.tokenStore.hasAccessToken()) {
        console.log('❌ Interceptor - No token available');
        return req;
      }
      
      // Check if token is expired and refresh if needed
      try {
        const accessToken = this.tokenStore.getAccessToken();
        if (!accessToken) {
          console.log('❌ Interceptor - No access token');
          return req;
        }
        
        console.log('✅ Interceptor - Adding Authorization header');
        
        const decoded = jwtDecode<JwtPayload>(accessToken);
        const currentTime = Math.floor(Date.now() / 1000);
      
        // If token expires in less than 60 seconds, refresh it
        if (decoded.exp && decoded.exp - currentTime < 60) {
          // For session-based tokens, get a new token from the session
          if (decoded.sessionId) {
            try {
              const res = await this.client.get(`/api/session/token/${decoded.sessionId}`);
              this.tokenStore.setTokens(res.data.accessToken);
            } catch (refreshError) {
              // If refresh fails, clear tokens
              this.clearTokens();
            }
          }
        }
        
        // Add authorization header
        const currentToken = this.tokenStore.getAccessToken();
        if (currentToken) {
          req.headers.Authorization = `Bearer ${currentToken}`;
          console.log('✅ Interceptor - Authorization header set');
        }
      } catch (error) {
        console.log('❌ Interceptor - Error processing token:', error);
        // If token is invalid, clear it
        this.clearTokens();
      }
      
      return req;
    });
  }

  /**
   * Get the configured base URL
   */
  public getBaseURL(): string {
    return this.client.defaults.baseURL || '';
  }

  /**
   * Set authentication tokens
   */
  public setTokens(accessToken: string, refreshToken: string = ''): void {
    this.tokenStore.setTokens(accessToken, refreshToken);
  }

  /**
   * Clear stored authentication tokens
   */
  public clearTokens(): void {
    this.tokenStore.clearTokens();
  }

  /**
   * Get the current user ID from the access token
   */
  public getCurrentUserId(): string | null {
    const accessToken = this.tokenStore.getAccessToken();
    if (!accessToken) {
      return null;
    }
    
    try {
      const decoded = jwtDecode<JwtPayload>(accessToken);
      return decoded.userId || decoded.id || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if the client has a valid access token
   */
  private hasAccessToken(): boolean {
    return this.tokenStore.hasAccessToken();
  }

  /**
   * Validate the current access token with the server
   */
  async validate(): Promise<boolean> {
    if (!this.hasAccessToken()) {
      return false;
    }

    try {
      const res = await this.client.get('/api/auth/validate');
      return res.data.valid === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get the HTTP client instance (protected for use by service modules)
   */
  protected getClient(): AxiosInstance {
    return this.client;
  }

  /**
   * Centralized error handling
   */
  protected handleError(error: any): ApiError {
    return handleHttpError(error);
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{ 
    status: string; 
    users?: number; 
    timestamp?: string; 
    [key: string]: any 
  }> {
    try {
      const res = await this.client.get('/health');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Simple Express.js authentication middleware
   * 
   * Built-in authentication middleware that validates JWT tokens and adds user data to requests.
   * 
   * @example
   * ```typescript
   * // Basic usage - just add it to your routes
   * app.use('/api/protected', oxyServices.auth());
   * 
   * // With debug logging
   * app.use('/api/protected', oxyServices.auth({ debug: true }));
   * 
   * // With custom error handling
   * app.use('/api/protected', oxyServices.auth({
   *   onError: (error) => console.error('Auth failed:', error)
   * }));
   * 
   * // Load full user data
   * app.use('/api/protected', oxyServices.auth({ loadUser: true }));
   * ```
   * 
   * @param options Optional configuration
   * @param options.debug Enable debug logging (default: false)
   * @param options.onError Custom error handler
   * @param options.loadUser Load full user data (default: false for performance)
   * @param options.session Use session-based validation (default: false)
   * @returns Express middleware function
   */
  auth(options: {
    debug?: boolean;
    onError?: (error: ApiError) => any;
    loadUser?: boolean;
    session?: boolean;
  } = {}) {
    const { debug = false, onError, loadUser = false, session = false } = options;
    
    // Return a synchronous middleware function
    return (req: any, res: any, next: any) => {
      try {
        // Extract token from Authorization header
        const authHeader = req.headers['authorization'];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
        
        if (debug) {
          console.log(`🔐 Auth: Processing ${req.method} ${req.path}`);
          console.log(`🔐 Auth: Token present: ${!!token}`);
        }
        
        if (!token) {
          const error = {
            message: 'Access token required',
            code: 'MISSING_TOKEN',
            status: 401
          };
          
          if (debug) console.log(`❌ Auth: Missing token`);
          
          if (onError) return onError(error);
          return res.status(401).json(error);
        }
        
        // Decode and validate token
        let decoded: JwtPayload;
        try {
          decoded = jwtDecode<JwtPayload>(token);
          
          if (debug) {
            console.log(`🔐 Auth: Token decoded, User ID: ${decoded.userId || decoded.id}`);
          }
        } catch (decodeError) {
          const error = {
            message: 'Invalid token format',
            code: 'INVALID_TOKEN_FORMAT',
            status: 403
          };
          
          if (debug) console.log(`❌ Auth: Token decode failed`);
          
          if (onError) return onError(error);
          return res.status(403).json(error);
        }
        
        const userId = decoded.userId || decoded.id;
        if (!userId) {
          const error = {
            message: 'Token missing user ID',
            code: 'INVALID_TOKEN_PAYLOAD',
            status: 403
          };
          
          if (debug) console.log(`❌ Auth: Token missing user ID`);
          
          if (onError) return onError(error);
          return res.status(403).json(error);
        }
        
        // Check token expiration
        if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
          const error = {
            message: 'Token expired',
            code: 'TOKEN_EXPIRED',
            status: 403
          };
          
          if (debug) console.log(`❌ Auth: Token expired`);
          
          if (onError) return onError(error);
          return res.status(403).json(error);
        }
        
        // For now, skip session validation to keep it simple
        // Session validation can be added later if needed
        
        // Set request properties immediately
        req.userId = userId;
        req.accessToken = token;
        req.user = { id: userId } as User;
        
        if (debug) {
          console.log(`✅ Auth: Authentication successful for user ${userId}`);
        }
        
        next();
      } catch (error) {
        const apiError = this.handleError(error);
        
        if (debug) {
          console.log(`❌ Auth: Unexpected error:`, apiError);
        }
        
        if (onError) return onError(apiError);
        return res.status(apiError.status || 500).json(apiError);
      }
    };
  }
}