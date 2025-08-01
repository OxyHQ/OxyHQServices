/**
 * Tests for the OxyServices fixes to prevent TypeError when accessing searchProfiles
 */

import { OxyServices } from '../OxyServices';
import { ErrorCodes } from '../../utils/errorUtils';

// Mock axios to avoid actual HTTP calls, but allow validation to work
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn().mockResolvedValue({ data: [] }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() }
    }
  }))
}));

describe('OxyServices Validation Fixes', () => {
  let oxyServices: OxyServices;

  beforeEach(() => {
    oxyServices = new OxyServices({ baseURL: 'https://api.test.com' });
  });

  describe('Constructor validation', () => {
    it('should throw error when config is null', () => {
      expect(() => new OxyServices(null as any)).toThrow('Configuration is required');
    });

    it('should throw error when config is undefined', () => {
      expect(() => new OxyServices(undefined as any)).toThrow('Configuration is required');
    });

    it('should throw error when baseURL is missing', () => {
      expect(() => new OxyServices({} as any)).toThrow('baseURL is required in configuration');
    });

    it('should throw error when baseURL is empty string', () => {
      expect(() => new OxyServices({ baseURL: '' })).toThrow('baseURL is required in configuration');
    });
  });

  describe('searchProfiles validation', () => {
    it('should throw error when query is null', async () => {
      await expect(oxyServices.searchProfiles(null as any)).rejects.toMatchObject({
        message: 'Search query is required and must be a non-empty string',
        code: ErrorCodes.VALIDATION_ERROR,
        status: 400
      });
    });

    it('should throw error when query is undefined', async () => {
      await expect(oxyServices.searchProfiles(undefined as any)).rejects.toMatchObject({
        message: 'Search query is required and must be a non-empty string',
        code: ErrorCodes.VALIDATION_ERROR,
        status: 400
      });
    });

    it('should throw error when query is empty string', async () => {
      await expect(oxyServices.searchProfiles('')).rejects.toMatchObject({
        message: 'Search query is required and must be a non-empty string',
        code: ErrorCodes.VALIDATION_ERROR,
        status: 400
      });
    });

    it('should throw error when query is whitespace only', async () => {
      await expect(oxyServices.searchProfiles('   ')).rejects.toMatchObject({
        message: 'Search query is required and must be a non-empty string',
        code: ErrorCodes.VALIDATION_ERROR,
        status: 400
      });
    });

    it('should return empty array on successful call with no results', async () => {
      const result = await oxyServices.searchProfiles('test');
      expect(result).toEqual([]);
    });
  });

  describe('signUp validation', () => {
    it('should throw error when username is null', async () => {
      await expect(oxyServices.signUp(null as any, 'email@test.com', 'password')).rejects.toMatchObject({
        message: 'Username is required and must be a non-empty string',
        code: ErrorCodes.VALIDATION_ERROR,
        status: 400
      });
    });

    it('should throw error when email is null', async () => {
      await expect(oxyServices.signUp('username', null as any, 'password')).rejects.toMatchObject({
        message: 'Email is required and must be a non-empty string',
        code: ErrorCodes.VALIDATION_ERROR,
        status: 400
      });
    });

    it('should throw error when password is null', async () => {
      await expect(oxyServices.signUp('username', 'email@test.com', null as any)).rejects.toMatchObject({
        message: 'Password is required and must be a non-empty string',
        code: ErrorCodes.VALIDATION_ERROR,
        status: 400
      });
    });
  });

  describe('signIn validation', () => {
    it('should throw error when username is null', async () => {
      await expect(oxyServices.signIn(null as any, 'password')).rejects.toMatchObject({
        message: 'Username is required and must be a non-empty string',
        code: ErrorCodes.VALIDATION_ERROR,
        status: 400
      });
    });

    it('should throw error when password is null', async () => {
      await expect(oxyServices.signIn('username', null as any)).rejects.toMatchObject({
        message: 'Password is required and must be a non-empty string',
        code: ErrorCodes.VALIDATION_ERROR,
        status: 400
      });
    });
  });

  describe('getUserBySession validation', () => {
    it('should throw error when sessionId is null', async () => {
      await expect(oxyServices.getUserBySession(null as any)).rejects.toMatchObject({
        message: 'Session ID is required and must be a non-empty string',
        code: ErrorCodes.VALIDATION_ERROR,
        status: 400
      });
    });

    it('should throw error when sessionId is empty string', async () => {
      await expect(oxyServices.getUserBySession('')).rejects.toMatchObject({
        message: 'Session ID is required and must be a non-empty string',
        code: ErrorCodes.VALIDATION_ERROR,
        status: 400
      });
    });
  });

  describe('Error handling', () => {
    it('should handle service client being null', async () => {
      // Simulate client being null by setting it directly
      (oxyServices as any).client = null;
      
      await expect(oxyServices.searchProfiles('test')).rejects.toMatchObject({
        message: 'Service client is not initialized',
        code: ErrorCodes.INTERNAL_ERROR,
        status: 500
      });
    });

    it('should handle service client being undefined', async () => {
      // Simulate client being undefined
      (oxyServices as any).client = undefined;
      
      await expect(oxyServices.searchProfiles('test')).rejects.toMatchObject({
        message: 'Service client is not initialized',
        code: ErrorCodes.INTERNAL_ERROR,
        status: 500
      });
    });
  });
});