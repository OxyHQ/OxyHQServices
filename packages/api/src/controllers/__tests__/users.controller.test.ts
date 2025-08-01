import { Request, Response, NextFunction } from 'express';
import { UsersController } from '../users.controller';

// Mock the User model
const mockUser = {
  find: jest.fn(),
  select: jest.fn(),
  limit: jest.fn(),
};

jest.mock('../models/User', () => mockUser);

describe('UsersController', () => {
  let usersController: UsersController;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    usersController = new UsersController();
    mockRequest = {};
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('searchUsers', () => {
    it('should return 400 if query is missing', async () => {
      mockRequest.body = {};

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid request',
        message: 'Search query is required'
      });
    });

    it('should return 400 if query is not a string', async () => {
      mockRequest.body = { query: 123 };

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid request',
        message: 'Search query is required'
      });
    });

    it('should search users successfully', async () => {
      const mockUsers = [
        { username: 'testuser', name: { first: 'Test', last: 'User' } },
        { username: 'anotheruser', name: { first: 'Another', last: 'User' } },
      ];

      mockRequest.body = { query: 'test' };

      // Mock the User.find chain
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockUsers),
      };
      mockUser.find.mockReturnValue(mockQuery);

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockUser.find).toHaveBeenCalledWith({
        $or: [
          { username: { $regex: 'test', $options: 'i' } },
          { 'name.first': { $regex: 'test', $options: 'i' } },
          { 'name.last': { $regex: 'test', $options: 'i' } }
        ]
      });
      expect(mockQuery.select).toHaveBeenCalledWith('username name avatar email description');
      expect(mockQuery.limit).toHaveBeenCalledWith(5);
      expect(mockResponse.json).toHaveBeenCalledWith({
        data: mockUsers
      });
    });

    it('should handle database errors', async () => {
      mockRequest.body = { query: 'test' };

      const mockError = new Error('Database error');
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockRejectedValue(mockError),
      };
      mockUser.find.mockReturnValue(mockQuery);

      // Mock console.error to avoid test output pollution
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Server error',
        message: 'Error searching users: Database error'
      });

      consoleSpy.mockRestore();
    });
  });
});