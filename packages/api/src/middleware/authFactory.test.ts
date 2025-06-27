/// <reference types="jest" />
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { createAuth, AuthenticatedRequest } from './authFactory'; // Assuming IUser is exported or use any
import User, { IUser } from '../models/User'; // Adjust path as necessary

// Mock logger
jest.mock('../utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

const mockUser: IUser = {
  _id: new mongoose.Types.ObjectId(),
  username: 'testuser',
  email: 'test@example.com',
  password: 'hashedpassword', // In reality, this would be hashed
  // Add any other required fields for IUser
  name: { first: 'Test', last: 'User' },
  createdAt: new Date(),
  updatedAt: new Date(),
  // Ensure all required fields from IUser are present
  bookmarks: [],
  privacySettings: {
    isPrivateAccount: false,
    hideOnlineStatus: false,
    hideLastSeen: false,
    profileVisibility: true,
    postVisibility: true,
    twoFactorEnabled: false,
    loginAlerts: true,
    blockScreenshots: false,
    secureLogin: true,
    biometricLogin: false,
    showActivity: true,
    allowTagging: true,
    allowMentions: true,
    hideReadReceipts: false,
    allowComments: true,
    allowDirectMessages: true,
    dataSharing: true,
    locationSharing: false,
    analyticsSharing: true,
    sensitiveContent: false,
    autoFilter: true,
    muteKeywords: false,
  },
  associated: { lists: 0, feedgens: 0, starterPacks: 0, labeler: false },
  labels: [],
  description: '',
  coverPhoto: '',
  avatar: '',
  location: '',
  website: '',
  pinnedPost: { cid: '', uri: ''},
  _count: { followers:0, following:0, posts:0, karma: 0}
} as unknown as IUser;


// Mock User model
jest.mock('../models/User');
const MockedUser = User as jest.Mocked<typeof User>;


describe('AuthFactory Middleware', () => {
  const tokenSecret = 'testsecret';
  const auth = createAuth({ tokenSecret });
  const middleware = auth.middleware();

  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction = jest.fn();

  beforeEach(() => {
    mockRequest = {
      headers: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    nextFunction = jest.fn();
    (MockedUser.findById as jest.Mock).mockClear();
  });

  it('should return 401 if no token is provided', async () => {
    await middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Authentication token required.' });
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should return 401 if token is malformed (not Bearer)', async () => {
    mockRequest.headers = { authorization: 'Token someinvalidtoken' };
    await middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Authentication token required.' });
  });

  it('should return 401 if token is missing after Bearer', async () => {
    mockRequest.headers = { authorization: 'Bearer ' };
    await middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Authentication token is missing.' });
  });

  it('should return 401 if token is invalid (verification fails)', async () => {
    mockRequest.headers = { authorization: 'Bearer invalidtoken' };
    (jwt.verify as jest.Mock) = jest.fn().mockImplementation(() => {
      throw new jwt.JsonWebTokenError('invalid token');
    });
    await middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Invalid token.' });
  });

  it('should return 401 if token is expired', async () => {
    mockRequest.headers = { authorization: 'Bearer expiredtoken' };
    (jwt.verify as jest.Mock) = jest.fn().mockImplementation(() => {
      throw new jwt.TokenExpiredError('jwt expired', new Date());
    });
    await middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Token expired.' });
  });

  it('should return 401 if token payload has no id', async () => {
    const token = jwt.sign({ username: 'test' }, tokenSecret); // No id
    mockRequest.headers = { authorization: `Bearer ${token}` };
    (jwt.verify as jest.Mock) = jest.fn().mockReturnValue({ username: 'test' }); // Mock successful verify but no id

    await middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Invalid token: Payload missing ID.' });
  });

  it('should return 401 if user not found in DB', async () => {
    const token = jwt.sign({ id: mockUser._id.toString() }, tokenSecret);
    mockRequest.headers = { authorization: `Bearer ${token}` };
    (jwt.verify as jest.Mock) = jest.fn().mockReturnValue({ id: mockUser._id.toString() });
    (MockedUser.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(null) // User not found
    });

    await middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(MockedUser.findById).toHaveBeenCalledWith(mockUser._id.toString());
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Invalid token: User not found.' });
  });

  it('should call next() and attach user to req if token is valid and user exists', async () => {
    const userId = new mongoose.Types.ObjectId();
    const token = jwt.sign({ id: userId.toString() }, tokenSecret);
    mockRequest.headers = { authorization: `Bearer ${token}` };

    // Mock jwt.verify to return the decoded payload
    (jwt.verify as jest.Mock) = jest.fn().mockReturnValue({ id: userId.toString() });

    // Mock User.findById().select() to return the mock user
    (MockedUser.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser)
    });

    await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(jwt.verify).toHaveBeenCalledWith(token, tokenSecret);
    expect(MockedUser.findById).toHaveBeenCalledWith(userId.toString());
    expect((MockedUser.findById as jest.Mock).mock.results[0].value.select).toHaveBeenCalledWith('-password -refreshToken');
    expect(mockRequest.user).toEqual(mockUser);
    expect(nextFunction).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it('should throw error if tokenSecret is not provided to createAuth', () => {
    expect(() => createAuth({ tokenSecret: '' })).toThrow('[AuthFactory] Token secret must be provided.');
  });
});

// Mocking jwt.verify specifically for these tests
// Note: If jwt is used elsewhere and needs its original implementation, this might need adjustment
// or be placed inside the describe block with `jest.doMock` for finer control.
jest.mock('jsonwebtoken', () => ({
  ...jest.requireActual('jsonwebtoken'), // Import and retain default behavior
  verify: jest.fn(), // Mock verify
}));
