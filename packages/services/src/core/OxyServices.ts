import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { jwtDecode } from 'jwt-decode';
import { OxyConfig, ApiError } from '../models/interfaces';
import { handleHttpError } from '../utils/errorUtils';

interface JwtPayload {
  exp: number;
  userId: string;
  [key: string]: any;
}

/**
 * OxyServices - Base client library for interacting with the Oxy API
 * 
 * This class provides the core HTTP client setup, token management, and error handling.
 * Specific functionality is delegated to focused service modules.
 */
export class OxyServices {
  protected client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  /**
   * Creates a new instance of the OxyServices client
   * @param config - Configuration for the client
   */
  constructor(config: OxyConfig) {
    this.client = axios.create({ 
      baseURL: config.baseURL,
      timeout: 10000 // 10 second timeout
    });
    
    this.setupInterceptors();
  }

  /**
   * Setup axios interceptors for authentication and error handling
   */
  private setupInterceptors(): void {
    // Request interceptor for adding auth header and handling token refresh
    this.client.interceptors.request.use(async (req: InternalAxiosRequestConfig) => {
      if (!this.accessToken) {
        return req;
      }
      
      // Check if token is expired and refresh if needed
      try {
        const decoded = jwtDecode<JwtPayload>(this.accessToken);
        const currentTime = Math.floor(Date.now() / 1000);
      
        // If token expires in less than 60 seconds, refresh it
        if (decoded.exp - currentTime < 60) {
          // For session-based tokens, get a new token from the session
          if (decoded.sessionId) {
            try {
              const res = await this.client.get(`/session/token/${decoded.sessionId}`);
              this.accessToken = res.data.accessToken;
            } catch (refreshError) {
              // If refresh fails, clear tokens
              this.clearTokens();
            }
          }
        }
        
        // Add authorization header
        req.headers.Authorization = `Bearer ${this.accessToken}`;
      } catch (error) {
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
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  /**
   * Clear stored authentication tokens
   */
  public clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }

  /**
   * Get the current user ID from the access token
   */
  public getCurrentUserId(): string | null {
    if (!this.accessToken) {
      return null;
    }
    
    try {
      const decoded = jwtDecode<JwtPayload>(this.accessToken);
      return decoded.userId || decoded.id || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if the client has a valid access token
   */
  private hasAccessToken(): boolean {
    return !!this.accessToken;
  }

  /**
   * Validate the current access token with the server
   */
  async validate(): Promise<boolean> {
    if (!this.hasAccessToken()) {
      return false;
    }

    try {
      const res = await this.client.get('/auth/validate');
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
} 