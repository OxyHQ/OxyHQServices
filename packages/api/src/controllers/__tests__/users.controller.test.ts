import { Request, Response, NextFunction } from 'express';

const mockFind = jest.fn();

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: { find: mockFind },
}));

jest.mock('../../utils/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../utils/sanitize', () => ({
  sanitizeSearchQuery: jest.fn((q: string) => q),
}));

jest.mock('../../utils/asyncHandler', () => ({
  sendSuccess: jest.fn((res: any, data: any) => res.status(200).json({ data })),
}));

import { UsersController } from '../users.controller';
import { BadRequestError, InternalServerError } from '../../utils/error';

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
    it('should throw BadRequestError if query is missing', async () => {
      mockRequest.body = {};

      await expect(
        usersController.searchUsers(mockRequest as Request, mockResponse as Response, mockNext)
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw BadRequestError if query is not a string', async () => {
      mockRequest.body = { query: 123 };

      await expect(
        usersController.searchUsers(mockRequest as Request, mockResponse as Response, mockNext)
      ).rejects.toThrow(BadRequestError);
    });

    it('should search users successfully', async () => {
      const mockUsers = [
        { username: 'testuser', name: { first: 'Test', last: 'User' } },
        { username: 'anotheruser', name: { first: 'Another', last: 'User' } },
      ];

      mockRequest.body = { query: 'test' };

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockUsers),
      };
      mockFind.mockReturnValue(mockQuery);

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockFind).toHaveBeenCalledWith({
        $or: [
          { username: { $regex: 'test', $options: 'i' } },
          { 'name.first': { $regex: 'test', $options: 'i' } },
          { 'name.last': { $regex: 'test', $options: 'i' } },
        ],
      });
      expect(mockQuery.select).toHaveBeenCalledWith('username name avatar email description');
      expect(mockQuery.limit).toHaveBeenCalledWith(5);
      expect(mockQuery.lean).toHaveBeenCalled();
    });

    it('should throw InternalServerError on database errors', async () => {
      mockRequest.body = { query: 'test' };

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockRejectedValue(new Error('Database error')),
      };
      mockFind.mockReturnValue(mockQuery);

      await expect(
        usersController.searchUsers(mockRequest as Request, mockResponse as Response, mockNext)
      ).rejects.toThrow(InternalServerError);
    });
  });
});
