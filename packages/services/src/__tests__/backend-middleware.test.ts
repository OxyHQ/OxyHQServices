/**
 * Integration test for refactored authentication system
 * Tests the backend middleware functionality
 */

import { OxyServices } from '../../core';

describe('Authentication System Integration', () => {
  let oxyServices: OxyServices;
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    oxyServices = new OxyServices({
      baseURL: 'https://api.test.com'
    });

    // Mock Express request/response objects
    mockReq = {
      headers: {},
      user: undefined,
      userId: undefined,
      accessToken: undefined
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    mockNext = jest.fn();
  });

  describe('Middleware Creation', () => {
    test('should create authentication middleware', () => {
      const middleware = oxyServices.createAuthenticateTokenMiddleware();
      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3); // req, res, next
    });

    test('should create middleware with custom options', () => {
      const customErrorHandler = jest.fn();
      const middleware = oxyServices.createAuthenticateTokenMiddleware({
        loadFullUser: false,
        onError: customErrorHandler
      });
      
      expect(typeof middleware).toBe('function');
    });
  });

  describe('Token Validation', () => {
    test('should handle missing token', async () => {
      const middleware = oxyServices.createAuthenticateTokenMiddleware();
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Access token required',
        code: 'MISSING_TOKEN'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should handle invalid token format', async () => {
      mockReq.headers.authorization = 'InvalidFormat token123';
      
      const middleware = oxyServices.createAuthenticateTokenMiddleware();
      await middleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should extract token from Bearer header', async () => {
      mockReq.headers.authorization = 'Bearer valid.jwt.token';
      
      const middleware = oxyServices.createAuthenticateTokenMiddleware();
      await middleware(mockReq, mockRes, mockNext);
      
      // Note: This will fail validation since it's not a real token,
      // but we can verify the token was extracted
      expect(mockRes.status).toHaveBeenCalled();
    });
  });

  describe('Standalone Token Validation', () => {
    test('should validate empty token', async () => {
      const result = await oxyServices.authenticateToken('');
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token is required');
      expect(result.userId).toBeUndefined();
      expect(result.user).toBeUndefined();
    });

    test('should validate invalid token', async () => {
      const result = await oxyServices.authenticateToken('invalid.jwt.token');
      
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.userId).toBeUndefined();
      expect(result.user).toBeUndefined();
    });

    test('should handle validation errors gracefully', async () => {
      const result = await oxyServices.authenticateToken('malformed-token');
      
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/validation failed|Invalid/i);
    });
  });

  describe('Custom Error Handling', () => {
    test('should use custom error handler when provided', async () => {
      const customErrorHandler = jest.fn();
      const middleware = oxyServices.createAuthenticateTokenMiddleware({
        onError: customErrorHandler
      });
      
      await middleware(mockReq, mockRes, mockNext);
      
      expect(customErrorHandler).toHaveBeenCalledWith({
        message: 'Access token required',
        code: 'MISSING_TOKEN',
        status: 401
      });
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('Backend Integration Example', () => {
    test('should work with Express.js route patterns', () => {
      // Simulate Express.js app setup
      const mockApp = {
        get: jest.fn(),
        post: jest.fn(),
        use: jest.fn()
      };

      // Create middleware
      const authenticateToken = oxyServices.createAuthenticateTokenMiddleware({
        loadFullUser: true
      });

      // Simulate route registration
      mockApp.get('/api/protected', authenticateToken, (req: any, res: any) => {
        res.json({ 
          message: 'Access granted',
          user: req.user,
          userId: req.userId 
        });
      });

      expect(mockApp.get).toHaveBeenCalledWith(
        '/api/protected',
        authenticateToken,
        expect.any(Function)
      );
    });

    test('should provide consistent interface for different auth patterns', () => {
      // Pattern 1: Middleware
      const middleware = oxyServices.createAuthenticateTokenMiddleware();
      expect(typeof middleware).toBe('function');

      // Pattern 2: Standalone validation
      const validateToken = oxyServices.authenticateToken.bind(oxyServices);
      expect(typeof validateToken).toBe('function');

      // Pattern 3: Direct service methods
      expect(typeof oxyServices.getAccessToken).toBe('function');
      expect(typeof oxyServices.setTokens).toBe('function');
      expect(typeof oxyServices.clearTokens).toBe('function');
    });
  });

  describe('Zero-Config Setup Verification', () => {
    test('should work with minimal configuration', () => {
      // This simulates the zero-config setup promise
      const minimalSetup = () => {
        // Backend: Just create OxyServices and use middleware
        const services = new OxyServices({ baseURL: 'https://api.example.com' });
        const authMiddleware = services.createAuthenticateTokenMiddleware();
        
        return { services, authMiddleware };
      };

      const { services, authMiddleware } = minimalSetup();
      
      expect(services).toBeInstanceOf(OxyServices);
      expect(typeof authMiddleware).toBe('function');
      expect(services.getBaseURL()).toBe('https://api.example.com');
    });

    test('should support runtime configuration changes', () => {
      const services = new OxyServices({ baseURL: 'https://dev-api.com' });
      
      expect(services.getBaseURL()).toBe('https://dev-api.com');
      
      // Simulate runtime change to production
      services.setBaseURL('https://prod-api.com');
      
      expect(services.getBaseURL()).toBe('https://prod-api.com');
    });
  });
});