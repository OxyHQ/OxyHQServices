/**
 * Comprehensive test suite for Zero-Config Authentication
 */

import { AuthenticationManager } from '../core/auth-manager';
import { authenticateRequest, OxyRequest } from '../../api/src/middleware/zero-config-auth';
import jwt from 'jsonwebtoken';

// Mock AsyncStorage for React Native
const mockAsyncStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// Mock axios
const mockAxiosInstance = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  interceptors: {
    request: { use: jest.fn() },
    response: { use: jest.fn() }
  },
  defaults: { baseURL: 'http://localhost:3001' }
};

jest.mock('axios', () => ({
  create: jest.fn(() => mockAxiosInstance),
}));

describe('AuthenticationManager', () => {
  let authManager: AuthenticationManager;

  beforeEach(() => {
    jest.clearAllMocks();
    authManager = new AuthenticationManager('http://localhost:3001');
  });

  describe('initialization', () => {
    it('should create axios client with correct config', () => {
      expect(require('axios').create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:3001',
        timeout: 15000,
        withCredentials: true,
      });
    });

    it('should setup request and response interceptors', () => {
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });

    it('should attempt to initialize from storage', async () => {
      expect(mockAsyncStorage.getItem).toHaveBeenCalledWith('@oxy/auth-tokens');
    });
  });

  describe('login', () => {
    const mockLoginResponse = {
      data: {
        success: true,
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user: { id: 'user123', username: 'testuser' }
      }
    };

    beforeEach(() => {
      mockAxiosInstance.post.mockResolvedValue(mockLoginResponse);
    });

    it('should successfully login with valid credentials', async () => {
      const result = await authManager.login({ username: 'test', password: 'pass' });
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/login', {
        username: 'test',
        password: 'pass'
      });
      
      expect(result).toEqual(mockLoginResponse.data);
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        '@oxy/auth-tokens',
        JSON.stringify({
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token'
        })
      );
    });

    it('should throw error for invalid credentials', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Invalid credentials'));
      
      await expect(authManager.login({ username: 'test', password: 'wrong' }))
        .rejects.toThrow('Invalid credentials');
    });

    it('should handle server error responses', async () => {
      const errorResponse = {
        response: {
          data: { message: 'Server error occurred' },
          status: 500
        }
      };
      mockAxiosInstance.post.mockRejectedValue(errorResponse);
      
      await expect(authManager.login({ username: 'test', password: 'pass' }))
        .rejects.toThrow('Server error occurred');
    });
  });

  describe('register', () => {
    const mockRegisterResponse = {
      data: {
        success: true,
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user: { id: 'user123', username: 'newuser', email: 'new@test.com' }
      }
    };

    beforeEach(() => {
      mockAxiosInstance.post.mockResolvedValue(mockRegisterResponse);
    });

    it('should successfully register new user', async () => {
      const userData = {
        username: 'newuser',
        email: 'new@test.com',
        password: 'password123'
      };
      
      const result = await authManager.register(userData);
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/register', userData);
      expect(result).toEqual(mockRegisterResponse.data);
    });

    it('should handle registration errors', async () => {
      const errorResponse = {
        response: {
          data: { message: 'Username already exists' },
          status: 400
        }
      };
      mockAxiosInstance.post.mockRejectedValue(errorResponse);
      
      await expect(authManager.register({
        username: 'existing',
        email: 'test@test.com',
        password: 'pass'
      })).rejects.toThrow('Username already exists');
    });
  });

  describe('logout', () => {
    beforeEach(() => {
      mockAxiosInstance.post.mockResolvedValue({ data: { success: true } });
    });

    it('should successfully logout and clear tokens', async () => {
      // Set some tokens first
      (authManager as any).tokens = {
        accessToken: 'token1',
        refreshToken: 'token2'
      };
      
      await authManager.logout();
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/logout', {
        refreshToken: 'token2'
      });
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('@oxy/auth-tokens');
    });

    it('should clear tokens even if server logout fails', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Server error'));
      
      (authManager as any).tokens = {
        accessToken: 'token1',
        refreshToken: 'token2'
      };
      
      await authManager.logout();
      
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('@oxy/auth-tokens');
    });
  });

  describe('getAuthState', () => {
    it('should return unauthenticated state initially', () => {
      const state = authManager.getAuthState();
      
      expect(state).toEqual({
        isAuthenticated: false,
        user: null,
        tokens: null
      });
    });

    it('should return authenticated state when tokens are present', () => {
      (authManager as any).tokens = {
        accessToken: 'token1',
        refreshToken: 'token2'
      };
      (authManager as any).user = { id: 'user123', username: 'test' };
      
      const state = authManager.getAuthState();
      
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual({ id: 'user123', username: 'test' });
      expect(state.tokens).toEqual({
        accessToken: 'token1',
        refreshToken: 'token2'
      });
    });
  });

  describe('onAuthStateChange', () => {
    it('should call callback immediately with current state', () => {
      const callback = jest.fn();
      
      authManager.onAuthStateChange(callback);
      
      expect(callback).toHaveBeenCalledWith({
        isAuthenticated: false,
        user: null,
        tokens: null
      });
    });

    it('should return unsubscribe function', () => {
      const callback = jest.fn();
      
      const unsubscribe = authManager.onAuthStateChange(callback);
      
      expect(typeof unsubscribe).toBe('function');
    });

    it('should notify listeners on state changes', () => {
      const callback = jest.fn();
      authManager.onAuthStateChange(callback);
      
      callback.mockClear();
      
      // Simulate state change
      (authManager as any).tokens = { accessToken: 'new-token', refreshToken: 'new-refresh' };
      (authManager as any).notifyStateChange();
      
      expect(callback).toHaveBeenCalledWith({
        isAuthenticated: true,
        user: null,
        tokens: { accessToken: 'new-token', refreshToken: 'new-refresh' }
      });
    });
  });

  describe('username and email validation', () => {
    it('should check username availability', async () => {
      const mockResponse = { data: { available: true, message: 'Username available' } };
      mockAxiosInstance.get.mockResolvedValue(mockResponse);
      
      const result = await authManager.checkUsernameAvailability('newuser');
      
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/auth/check-username/newuser');
      expect(result).toEqual({ available: true, message: 'Username available' });
    });

    it('should check email availability', async () => {
      const mockResponse = { data: { available: false, message: 'Email already registered' } };
      mockAxiosInstance.post.mockResolvedValue(mockResponse);
      
      const result = await authManager.checkEmailAvailability('test@example.com');
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/check-email', {
        email: 'test@example.com'
      });
      expect(result).toEqual({ available: false, message: 'Email already registered' });
    });

    it('should handle validation errors gracefully', async () => {
      const errorResponse = {
        response: {
          status: 400,
          data: { available: false, message: 'Invalid username format' }
        }
      };
      mockAxiosInstance.get.mockRejectedValue(errorResponse);
      
      const result = await authManager.checkUsernameAvailability('invalid@user');
      
      expect(result).toEqual({ available: false, message: 'Invalid username format' });
    });
  });
});

describe('Zero-Config Backend Middleware', () => {
  let mockReq: Partial<OxyRequest>;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = {
      headers: {},
      cookies: {}
    };
    
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    
    mockNext = jest.fn();
    
    // Mock JWT secret
    process.env.ACCESS_TOKEN_SECRET = 'test-secret';
  });

  afterEach(() => {
    delete process.env.ACCESS_TOKEN_SECRET;
  });

  describe('authenticateRequest', () => {
    it('should require authentication by default', async () => {
      const middleware = authenticateRequest();
      
      await middleware(mockReq as any, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: 'MISSING_TOKEN',
        message: 'Authentication required'
      }));
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should allow optional authentication', async () => {
      const middleware = authenticateRequest({ required: false });
      
      await middleware(mockReq as any, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should validate JWT tokens', async () => {
      const token = jwt.sign(
        { id: 'user123', userId: 'user123', username: 'test' },
        'test-secret',
        { expiresIn: '1h' }
      );
      
      mockReq.headers!.authorization = `Bearer ${token}`;
      
      // Mock User.findById
      const mockUser = {
        _id: 'user123',
        id: 'user123',
        username: 'test',
        email: 'test@example.com'
      };
      
      jest.mock('../../api/src/models/User', () => ({
        findById: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue(mockUser)
        })
      }));
      
      const middleware = authenticateRequest();
      
      await middleware(mockReq as any, mockRes, mockNext);
      
      expect(mockReq.userId).toBe('user123');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle expired tokens', async () => {
      const expiredToken = jwt.sign(
        { id: 'user123', userId: 'user123', username: 'test' },
        'test-secret',
        { expiresIn: '-1h' } // Expired
      );
      
      mockReq.headers!.authorization = `Bearer ${expiredToken}`;
      
      const middleware = authenticateRequest();
      
      await middleware(mockReq as any, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'TOKEN_EXPIRED',
        message: 'Token has expired'
      }));
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle invalid tokens', async () => {
      mockReq.headers!.authorization = 'Bearer invalid-token';
      
      const middleware = authenticateRequest();
      
      await middleware(mockReq as any, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'INVALID_TOKEN',
        message: 'Invalid token'
      }));
    });

    it('should call custom error handler when provided', async () => {
      const customErrorHandler = jest.fn();
      const middleware = authenticateRequest({ onError: customErrorHandler });
      
      await middleware(mockReq as any, mockRes, mockNext);
      
      expect(customErrorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'MISSING_TOKEN',
          statusCode: 401
        }),
        mockReq,
        mockRes
      );
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should skip authentication when skipIf condition is met', async () => {
      const skipCondition = jest.fn().mockReturnValue(true);
      const middleware = authenticateRequest({ skipIf: skipCondition });
      
      await middleware(mockReq as any, mockRes, mockNext);
      
      expect(skipCondition).toHaveBeenCalledWith(mockReq);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('token extraction', () => {
    it('should extract token from Authorization header', async () => {
      const token = jwt.sign(
        { id: 'user123', userId: 'user123', username: 'test' },
        'test-secret',
        { expiresIn: '1h' }
      );
      
      mockReq.headers!.authorization = `Bearer ${token}`;
      
      const middleware = authenticateRequest({ loadFullUser: false });
      await middleware(mockReq as any, mockRes, mockNext);
      
      expect(mockReq.userId).toBe('user123');
    });

    it('should extract token from cookies as fallback', async () => {
      const token = jwt.sign(
        { id: 'user123', userId: 'user123', username: 'test' },
        'test-secret',
        { expiresIn: '1h' }
      );
      
      mockReq.cookies!.accessToken = token;
      
      const middleware = authenticateRequest({ loadFullUser: false });
      await middleware(mockReq as any, mockRes, mockNext);
      
      expect(mockReq.userId).toBe('user123');
    });

    it('should handle malformed Authorization header', async () => {
      mockReq.headers!.authorization = 'InvalidFormat token';
      
      const middleware = authenticateRequest();
      await middleware(mockReq as any, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'MISSING_TOKEN'
      }));
    });
  });

  describe('error handling', () => {
    it('should provide consistent error response format', async () => {
      const middleware = authenticateRequest();
      
      await middleware(mockReq as any, mockRes, mockNext);
      
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'MISSING_TOKEN',
        message: 'Authentication required',
        timestamp: expect.any(String)
      });
    });

    it('should handle internal server errors gracefully', async () => {
      // Force an internal error
      const middleware = authenticateRequest();
      
      // Mock internal error by making the middleware throw
      mockReq.headers = undefined as any;
      
      await middleware(mockReq as any, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(expect.any(Number));
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false
      }));
    });
  });
});

describe('Integration Tests', () => {
  describe('Frontend-Backend Authentication Flow', () => {
    let authManager: AuthenticationManager;
    
    beforeEach(() => {
      authManager = new AuthenticationManager('http://localhost:3001');
    });

    it('should handle complete login flow', async () => {
      const mockLoginResponse = {
        data: {
          success: true,
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          user: { id: 'user123', username: 'testuser' }
        }
      };
      
      mockAxiosInstance.post.mockResolvedValue(mockLoginResponse);
      
      // Login
      const result = await authManager.login({ username: 'test', password: 'pass' });
      expect(result.success).toBe(true);
      
      // Check auth state
      const authState = authManager.getAuthState();
      expect(authState.isAuthenticated).toBe(true);
      expect(authState.user).toEqual(mockLoginResponse.data.user);
      
      // Verify tokens are stored
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        '@oxy/auth-tokens',
        expect.stringContaining('mock-access-token')
      );
    });

    it('should handle authentication errors gracefully', async () => {
      const errorResponse = {
        response: {
          status: 401,
          data: { message: 'Invalid credentials' }
        }
      };
      
      mockAxiosInstance.post.mockRejectedValue(errorResponse);
      
      await expect(authManager.login({ username: 'test', password: 'wrong' }))
        .rejects.toThrow('Invalid credentials');
      
      const authState = authManager.getAuthState();
      expect(authState.isAuthenticated).toBe(false);
    });
  });

  describe('Token Lifecycle Management', () => {
    it('should automatically refresh tokens before expiration', async () => {
      const mockToken = jwt.sign(
        { id: 'user123', userId: 'user123' },
        'test-secret',
        { expiresIn: '1m' } // Short expiry for testing
      );
      
      const authManager = new AuthenticationManager('http://localhost:3001');
      
      // Set tokens
      (authManager as any).tokens = {
        accessToken: mockToken,
        refreshToken: 'refresh-token'
      };
      
      // Mock refresh response
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token'
        }
      });
      
      // Simulate a request that should trigger refresh
      await (authManager as any).ensureValidToken();
      
      // Verify refresh was called
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/refresh', {
        refreshToken: 'refresh-token'
      });
    });
  });
});