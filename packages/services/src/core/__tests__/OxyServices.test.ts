import { OxyServices, OxyAuthenticationError, OxyAuthenticationTimeoutError } from '../OxyServices';
import { OXY_CLOUD_URL } from '../index';

// Mock axios for testing
jest.mock('axios');

describe('OxyServices', () => {
  let oxyServices: OxyServices;

  beforeEach(() => {
    // Create a fresh instance for each test
    oxyServices = new OxyServices({ baseURL: 'https://test.example.com' });
    jest.clearAllMocks();
  });

  describe('Constructor and Configuration', () => {
    it('should create an instance with the provided baseURL', () => {
      const customURL = 'https://custom.example.com';
      const service = new OxyServices({ baseURL: customURL });
      expect(service.getBaseURL()).toBe(customURL);
    });

    it('should have a default cloud URL constant', () => {
      expect(OXY_CLOUD_URL).toBe('https://cloud.oxy.so');
    });
  });

  describe('Token Management', () => {
    it('should set and retrieve tokens', () => {
      const accessToken = 'test-access-token';
      const refreshToken = 'test-refresh-token';

      oxyServices.setTokens(accessToken, refreshToken);
      expect(oxyServices.hasValidToken()).toBe(true);
    });

    it('should clear tokens', () => {
      oxyServices.setTokens('test-token', 'refresh-token');
      expect(oxyServices.hasValidToken()).toBe(true);

      oxyServices.clearTokens();
      expect(oxyServices.hasValidToken()).toBe(false);
    });

    it('should return null for user ID when no token is set', () => {
      expect(oxyServices.getCurrentUserId()).toBeNull();
    });
  });

  describe('Authentication Methods', () => {
    it('should call signUp endpoint with correct parameters', async () => {
      const mockAxios = require('axios');
      const mockResponse = { data: { message: 'Success', token: 'test-token', user: { id: '1', username: 'test' } } };
      mockAxios.create().post.mockResolvedValue(mockResponse);

      const result = await oxyServices.signUp('testuser', 'test@example.com', 'password');

      expect(mockAxios.create().post).toHaveBeenCalledWith('/api/auth/signup', {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password'
      });
      expect(result).toEqual(mockResponse.data);
    });

    it('should call signIn endpoint with correct parameters', async () => {
      const mockAxios = require('axios');
      const mockResponse = { data: { accessToken: 'test-token', user: { id: '1', username: 'test' } } };
      mockAxios.create().post.mockResolvedValue(mockResponse);

      const result = await oxyServices.signIn('testuser', 'password');

      expect(mockAxios.create().post).toHaveBeenCalledWith('/api/auth/login', {
        username: 'testuser',
        password: 'password',
        deviceName: undefined,
        deviceFingerprint: undefined
      });
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('Session Management', () => {
    it('should get user by session ID', async () => {
      const mockAxios = require('axios');
      const mockUser = { id: '1', username: 'testuser' };
      mockAxios.create().get.mockResolvedValue({ data: mockUser });

      const result = await oxyServices.getUserBySession('test-session-id');

      expect(mockAxios.create().get).toHaveBeenCalledWith('/api/session/user/test-session-id');
      expect(result).toEqual(mockUser);
    });

    it('should get token by session ID and set it', async () => {
      const mockAxios = require('axios');
      const mockResponse = { data: { accessToken: 'new-token', expiresAt: '2024-01-01' } };
      mockAxios.create().get.mockResolvedValue(mockResponse);

      const result = await oxyServices.getTokenBySession('test-session-id');

      expect(mockAxios.create().get).toHaveBeenCalledWith('/api/session/token/test-session-id');
      expect(result).toEqual(mockResponse.data);
      expect(oxyServices.hasValidToken()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors correctly', async () => {
      const mockAxios = require('axios');
      const mockError = new Error('API Error');
      mockAxios.create().post.mockRejectedValue(mockError);

      await expect(oxyServices.signUp('test', 'test@example.com', 'pass')).rejects.toThrow();
    });
  });

  describe('Custom Error Types', () => {
    it('should create OxyAuthenticationError with correct properties', () => {
      const error = new OxyAuthenticationError('Test error', 'TEST_CODE', 401);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.status).toBe(401);
      expect(error.name).toBe('OxyAuthenticationError');
    });

    it('should create OxyAuthenticationTimeoutError with correct properties', () => {
      const error = new OxyAuthenticationTimeoutError('testOperation', 5000);
      expect(error.message).toContain('testOperation');
      expect(error.message).toContain('5000ms');
      expect(error.code).toBe('AUTH_TIMEOUT');
      expect(error.status).toBe(408);
      expect(error.name).toBe('OxyAuthenticationTimeoutError');
    });
  });

  describe('Health Check', () => {
    it('should call health check endpoint', async () => {
      const mockAxios = require('axios');
      const mockResponse = { data: { status: 'ok', timestamp: '2024-01-01' } };
      mockAxios.create().get.mockResolvedValue(mockResponse);

      const result = await oxyServices.healthCheck();

      expect(mockAxios.create().get).toHaveBeenCalledWith('/health');
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('Validation Methods', () => {
    it('should return false when no token is available for validation', async () => {
      const result = await oxyServices.validate();
      expect(result).toBe(false);
    });

    it('should validate token with server when token exists', async () => {
      const mockAxios = require('axios');
      oxyServices.setTokens('test-token');
      mockAxios.create().get.mockResolvedValue({ data: { valid: true } });

      const result = await oxyServices.validate();

      expect(mockAxios.create().get).toHaveBeenCalledWith('/api/auth/validate');
      expect(result).toBe(true);
    });
  });

  describe('Wait for Authentication', () => {
    it('should resolve immediately if token is already available', async () => {
      oxyServices.setTokens('test-token');
      const result = await oxyServices.waitForAuth(1000);
      expect(result).toBe(true);
    });

    it('should timeout if no token becomes available', async () => {
      const result = await oxyServices.waitForAuth(100);
      expect(result).toBe(false);
    });
  });
});