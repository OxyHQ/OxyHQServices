import { jwtDecode } from 'jwt-decode';
import { OxyServices } from '../OxyServices';
import { User, LoginResponse, ApiError } from '../../models/interfaces';
import { SessionLoginResponse } from '../../models/session';
import { validateAndSanitizeUserInput } from '../../utils/validationUtils';
import { validateRequiredFields } from '../../utils/errorUtils';

interface JwtPayload {
  exp: number;
  userId: string;
  [key: string]: any;
}

/**
 * Authentication service for handling login, signup, and session management
 */
export class AuthService extends OxyServices {
  /**
   * Sign up a new user
   */
  async signUp(username: string, email: string, password: string): Promise<{ message: string; token: string; user: User }> {
    try {
      const res = await this.getClient().post('/session/register', {
        username,
        email,
        password
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Sign in with device management
   */
  async signIn(username: string, password: string, deviceName?: string, deviceFingerprint?: any): Promise<SessionLoginResponse> {
    try {
      const res = await this.getClient().post('/session/login', {
        username,
        password,
        deviceName,
        deviceFingerprint
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user by session ID
   */
  async getUserBySession(sessionId: string): Promise<User> {
    try {
      const res = await this.getClient().get(`/session/user/${sessionId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get access token by session ID
   */
  async getTokenBySession(sessionId: string): Promise<{ accessToken: string; expiresAt: string }> {
    try {
      const res = await this.getClient().get(`/session/token/${sessionId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get sessions by session ID
   */
  async getSessionsBySessionId(sessionId: string): Promise<any[]> {
    try {
      const res = await this.getClient().get(`/session/sessions/${sessionId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout from a specific session
   */
  async logoutSession(sessionId: string, targetSessionId?: string): Promise<void> {
    try {
      await this.getClient().delete(`/session/logout/${sessionId}`, {
        data: { targetSessionId }
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout from all sessions
   */
  async logoutAllSessions(sessionId: string): Promise<void> {
    try {
      await this.getClient().delete(`/session/logout-all/${sessionId}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Validate a session with optional device fingerprint
   * 
   * @example
   * ```typescript
   * // Basic session validation
   * const result = await authService.validateSession('session-id');
   * 
   * // With device fingerprint for enhanced security
   * const result = await authService.validateSession('session-id', {
   *   deviceFingerprint: 'device-fingerprint',
   *   useHeaderValidation: true
   * });
   * ```
   * 
   * @param sessionId The session ID to validate
   * @param options Validation options
   * @param options.deviceFingerprint Optional device fingerprint for enhanced validation
   * @param options.useHeaderValidation Whether to use header-based validation (default: false)
   * @returns Session validation result
   */
  async validateSession(
    sessionId: string, 
    options: {
      deviceFingerprint?: string;
      useHeaderValidation?: boolean;
    } = {}
  ): Promise<{ 
    valid: boolean; 
    expiresAt: string; 
    lastActivity: string; 
    user: User;
    sessionId?: string;
    source?: string;
  }> {
    const { deviceFingerprint, useHeaderValidation = false } = options;
    
    try {
      if (useHeaderValidation) {
        // Use header-based validation with device fingerprint
        const res = await this.getClient().get(`/session/validate-header/${sessionId}`, {
          headers: deviceFingerprint ? { 'X-Device-Fingerprint': deviceFingerprint } : {}
        });
        return { ...res.data, source: 'header' };
      } else {
        // Use standard session validation
        const res = await this.getClient().get(`/session/validate/${sessionId}`);
        return { ...res.data, source: 'standard' };
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Express.js authentication middleware
   * 
   * A simple, efficient, and debuggable authentication middleware that supports both
   * session-based and legacy token-based authentication.
   * 
   * @example
   * ```typescript
   * // Basic usage
   * app.use('/api/protected', authService.authenticateToken());
   * 
   * // With debug logging
   * app.use('/api/protected', authService.authenticateToken({ debug: true }));
   * 
   * // Without loading full user data (faster)
   * app.use('/api/protected', authService.authenticateToken({ loadFullUser: false }));
   * 
   * // With custom error handling
   * app.use('/api/protected', authService.authenticateToken({
   *   onError: (error) => {
   *     console.error('Auth error:', error);
   *     // Custom error handling logic
   *   }
   * }));
   * ```
   * 
   * @param options Configuration options
   * @param options.loadFullUser Whether to load complete user data (default: true)
   * @param options.onError Custom error handler function
   * @param options.debug Enable debug logging (default: false)
   * @returns Express middleware function
   */
  authenticateToken(options: {
    loadFullUser?: boolean;
    onError?: (error: ApiError) => any;
    debug?: boolean;
  } = {}) {
    const { loadFullUser = true, onError, debug = false } = options;
    
    return async (req: any, res: any, next: any) => {
      const startTime = Date.now();
      
      try {
        // Extract token from Authorization header
        const authHeader = req.headers['authorization'];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
        
        if (debug) {
          console.log(`🔐 Auth Middleware: Processing request to ${req.method} ${req.path}`);
          console.log(`🔐 Auth Middleware: Token present: ${!!token}`);
        }
        
        if (!token) {
          const error = {
            message: 'Access token required',
            code: 'MISSING_TOKEN',
            status: 401
          };
          
          if (debug) console.log(`❌ Auth Middleware: Missing token`);
          
          if (onError) return onError(error);
          return res.status(401).json(error);
        }
        
        // Decode and validate token
        let decoded: JwtPayload;
        try {
          decoded = jwtDecode<JwtPayload>(token);
          
          if (debug) {
            console.log(`🔐 Auth Middleware: Token decoded successfully`);
            console.log(`🔐 Auth Middleware: User ID: ${decoded.userId || decoded.id}`);
            console.log(`🔐 Auth Middleware: Has session ID: ${!!decoded.sessionId}`);
          }
        } catch (decodeError) {
          const error = {
            message: 'Invalid token format',
            code: 'INVALID_TOKEN_FORMAT',
            status: 403
          };
          
          if (debug) console.log(`❌ Auth Middleware: Token decode failed:`, decodeError);
          
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
          
          if (debug) console.log(`❌ Auth Middleware: Token missing user ID`);
          
          if (onError) return onError(error);
          return res.status(403).json(error);
        }
        
        // Validate session or token
        let isValid = false;
        let user: User | null = null;
        
        if (decoded.sessionId) {
          // Session-based validation
          if (debug) console.log(`🔐 Auth Middleware: Using session validation for session: ${decoded.sessionId}`);
          
          try {
            const validation = await this.validateSession(decoded.sessionId, {
              useHeaderValidation: true
            });
            isValid = validation.valid;
            user = validation.user;
            
            if (debug) {
              console.log(`🔐 Auth Middleware: Session validation result: ${isValid}`);
              console.log(`🔐 Auth Middleware: User loaded: ${!!user}`);
            }
          } catch (sessionError) {
            if (debug) console.log(`❌ Auth Middleware: Session validation failed:`, sessionError);
            isValid = false;
          }
        } else {
          // Legacy token validation
          if (debug) console.log(`🔐 Auth Middleware: Using legacy token validation`);
          
          try {
            isValid = await this.validate();
            
            if (isValid && loadFullUser) {
              // Use minimal user data for performance - full user can be loaded separately if needed
              user = { id: userId } as User;
            }
            
            if (debug) {
              console.log(`🔐 Auth Middleware: Legacy validation result: ${isValid}`);
              console.log(`🔐 Auth Middleware: User loaded: ${!!user}`);
            }
          } catch (validationError) {
            if (debug) console.log(`❌ Auth Middleware: Legacy validation failed:`, validationError);
            isValid = false;
          }
        }
        
        if (!isValid) {
          const error = {
            message: 'Invalid or expired token',
            code: 'INVALID_TOKEN',
            status: 403
          };
          
          if (debug) console.log(`❌ Auth Middleware: Token validation failed`);
          
          if (onError) return onError(error);
          return res.status(403).json(error);
        }
        
        // Set request properties
        req.userId = userId;
        req.accessToken = token;
        req.user = user || { id: userId };
        
        if (debug) {
          const duration = Date.now() - startTime;
          console.log(`✅ Auth Middleware: Authentication successful in ${duration}ms`);
          console.log(`✅ Auth Middleware: User ID: ${userId}`);
          console.log(`✅ Auth Middleware: Full user loaded: ${loadFullUser && !!user}`);
        }
        
        next();
      } catch (error) {
        const duration = Date.now() - startTime;
        const apiError = this.handleError(error);
        
        if (debug) {
          console.log(`❌ Auth Middleware: Unexpected error after ${duration}ms:`, error);
          console.log(`❌ Auth Middleware: API Error:`, apiError);
        }
        
        if (onError) return onError(apiError);
        return res.status(apiError.status || 500).json(apiError);
      }
    };
  }

  /**
   * Helper method for validating tokens without Express middleware
   * 
   * Use this method when you need to validate tokens programmatically
   * outside of Express middleware context.
   * 
   * @example
   * ```typescript
   * const result = await authService.validateToken(token);
   * if (result.valid) {
   *   console.log('User ID:', result.userId);
   *   console.log('User data:', result.user);
   * } else {
   *   console.log('Validation failed:', result.error);
   * }
   * ```
   * 
   * @param token JWT token to validate
   * @returns Validation result with user data if valid
   */
  async validateToken(token: string): Promise<{
    valid: boolean;
    userId?: string;
    user?: any;
    error?: string;
  }> {
    try {
      if (!token) {
        return {
          valid: false,
          error: 'Token is required'
        };
      }
      
      // Decode token
      let decoded: JwtPayload;
      try {
        decoded = jwtDecode<JwtPayload>(token);
      } catch (decodeError) {
        return {
          valid: false,
          error: 'Invalid token format'
        };
      }
      
      const userId = decoded.userId || decoded.id;
      if (!userId) {
        return {
          valid: false,
          error: 'Token missing user ID'
        };
      }
      
      // Validate based on token type
      if (decoded.sessionId) {
        // Session-based validation
        try {
          const validation = await this.validateSession(decoded.sessionId, {
            useHeaderValidation: true
          });
          return {
            valid: validation.valid,
            userId,
            user: validation.user,
            error: validation.valid ? undefined : 'Invalid or expired session'
          };
        } catch (sessionError) {
          return {
            valid: false,
            userId,
            error: 'Session validation failed'
          };
        }
      } else {
        // Legacy token validation
        try {
          const isValid = await this.validate();
          if (!isValid) {
            return {
              valid: false,
              userId,
              error: 'Invalid or expired token'
            };
          }
          
          // Use minimal user data for performance
          const user = { id: userId } as User;
          
          return {
            valid: true,
            userId,
            user
          };
        } catch (validationError) {
          return {
            valid: false,
            userId,
            error: 'Token validation failed'
          };
        }
      }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Token validation failed'
      };
    }
  }

  /**
   * Get device sessions (delegates to DeviceService)
   */
  async getDeviceSessions(sessionId: string): Promise<any[]> {
    try {
      const res = await this.getClient().get(`/session/device/sessions/${sessionId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout from all device sessions (delegates to DeviceService)
   */
  async logoutAllDeviceSessions(sessionId: string): Promise<void> {
    try {
      await this.getClient().delete(`/session/device/logout-all/${sessionId}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update device name (delegates to DeviceService)
   */
  async updateDeviceName(sessionId: string, deviceName: string): Promise<void> {
    try {
      await this.getClient().put(`/session/device/name/${sessionId}`, { deviceName });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Check username availability by trying to get profile
   * Note: This method uses the profiles endpoint to check if username exists
   */
  async checkUsernameAvailability(username: string): Promise<{ available: boolean; message: string }> {
    try {
      // Try to get profile by username - if it exists, username is not available
      await this.getClient().get(`/profiles/username/${username}`);
      return { available: false, message: 'Username is already taken' };
    } catch (error: any) {
      // If profile not found (404), username is available
      if (error.response?.status === 404) {
        return { available: true, message: 'Username is available' };
      }
      
      // For other errors, assume available to avoid blocking registration
      console.warn('Username validation error, assuming available:', error);
      return { available: true, message: 'Username validation not available' };
    }
  }

  /**
   * Check email availability
   * Note: This method is not supported by the current API
   */
  async checkEmailAvailability(email: string): Promise<{ available: boolean; message: string }> {
    // Email validation is not supported by the current API
    // Return available to avoid blocking registration
    console.warn('Email validation not supported by API, assuming available');
    return { available: true, message: 'Email validation not available' };
  }

  // Note: getUserById and getUserProfileByUsername methods have been moved to UserService
  // Use oxyServices.users.getUserById() and oxyServices.users.getProfileByUsername() instead
} 