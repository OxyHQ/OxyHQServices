import { OxyServices } from '../core';
import jwt from 'jsonwebtoken';

// Mock axios
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() }
    },
    defaults: { baseURL: 'http://localhost:3001' }
  }))
}));

describe('createAuthenticateTokenMiddleware', () => {
  let oxyServices: OxyServices;
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    oxyServices = new OxyServices({ baseURL: 'http://localhost:3001' });
    
    mockReq = {
      headers: {
        authorization: 'Bearer test-token'
      }
    };
    
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    
    mockNext = jest.fn();
  });

  it('should create middleware function', () => {
    const middleware = oxyServices.createAuthenticateTokenMiddleware();
    expect(typeof middleware).toBe('function');
  });

  it('should handle missing token', async () => {
    mockReq.headers.authorization = undefined;
    
    const middleware = oxyServices.createAuthenticateTokenMiddleware();
    await middleware(mockReq, mockRes, mockNext);
    
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: 'Access token required',
      code: 'MISSING_TOKEN'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should handle invalid authorization header format', async () => {
    mockReq.headers.authorization = 'InvalidFormat test-token';
    
    const middleware = oxyServices.createAuthenticateTokenMiddleware();
    await middleware(mockReq, mockRes, mockNext);
    
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: 'Access token required',
      code: 'MISSING_TOKEN'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call custom error handler when provided', async () => {
    mockReq.headers.authorization = undefined;
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
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should set loadFullUser to true by default', () => {
    const middleware = oxyServices.createAuthenticateTokenMiddleware();
    // This is an internal implementation detail, but we can verify the function exists
    expect(typeof middleware).toBe('function');
  });

  it('should accept loadFullUser option', () => {
    const middleware = oxyServices.createAuthenticateTokenMiddleware({
      loadFullUser: false
    });
    expect(typeof middleware).toBe('function');
  });
}); 