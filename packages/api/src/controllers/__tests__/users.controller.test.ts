import type { Request, Response, NextFunction } from 'express';

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
  sendSuccess: jest.fn((res: Response, data: unknown) => res.status(200).json({ data })),
}));

import { UsersController } from '../users.controller';
import { BadRequestError, InternalServerError } from '../../utils/error';
import { PUBLIC_USER_PROFILE_SELECT } from '../../utils/publicUserProjection';
import { peopleSearchMongoMatch } from '../../utils/profileQuery';

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
        ...peopleSearchMongoMatch,
        $or: [
          { username: { $regex: 'test', $options: 'i' } },
          { 'name.first': { $regex: 'test', $options: 'i' } },
          { 'name.last': { $regex: 'test', $options: 'i' } },
        ],
      });
      // Search rows are PUBLIC user rows — same shared projection the
      // follower/following/mutual lists use, asserted against the exported
      // constant so the two cannot drift apart again.
      expect(mockQuery.select).toHaveBeenCalledWith(PUBLIC_USER_PROFILE_SELECT);
      expect(mockQuery.limit).toHaveBeenCalledWith(5);
      expect(mockQuery.lean).toHaveBeenCalled();
    });

    it('excludes archived accounts from the search filter', async () => {
      mockRequest.body = { query: 'test' };

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      mockFind.mockReturnValue(mockQuery);

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Dead federated actors (marked gone via POST /federation/actor-gone) and
      // archived org/project accounts are filtered so they never appear as
      // 0-post ghost search hits. Only `archived` is excluded — active accounts
      // (the default) still match.
      const filter = mockFind.mock.calls[0]?.[0] as { accountStatus?: unknown };
      expect(filter.accountStatus).toEqual({ $ne: 'archived' });
    });

    it('excludes private accounts from the search filter', async () => {
      mockRequest.body = { query: 'test' };

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      mockFind.mockReturnValue(mockQuery);

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      const filter = mockFind.mock.calls[0]?.[0] as {
        'privacySettings.isPrivateAccount'?: unknown;
      };
      expect(filter['privacySettings.isPrivateAccount']).toEqual({ $ne: true });
    });

    it('excludes restricted-tier users from the search filter', async () => {
      mockRequest.body = { query: 'test' };

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      mockFind.mockReturnValue(mockQuery);

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Users in the punitive `restricted` reputation tier (lifetime total < 0
      // OR abuseScore >= threshold) are hidden from people search alongside
      // archived accounts. `{ $ne: 'restricted' }` still matches docs whose
      // `reputationTier` is absent (untiered/new users), so no live user hides.
      const filter = mockFind.mock.calls[0]?.[0] as { reputationTier?: unknown };
      expect(filter.reputationTier).toEqual({ $ne: 'restricted' });
    });

    it('hides restricted OR archived users while an active untiered user shows', async () => {
      mockRequest.body = { query: 'match' };

      // A candidate pool exercising every axis: a restricted user, an archived
      // user, a non-punitive `trusted` user, and an untiered active user.
      const pool = [
        { username: 'clean_match', accountStatus: 'active' as const },
        { username: 'trusted_match', accountStatus: 'active' as const, reputationTier: 'trusted' as const },
        { username: 'archived_match', accountStatus: 'archived' as const, reputationTier: 'trusted' as const },
        { username: 'restricted_match', accountStatus: 'active' as const, reputationTier: 'restricted' as const },
      ];

      // Faithfully evaluate the controller's `{ $ne }` gates against the pool —
      // a missing field is NOT equal to the excluded value (Mongo semantics), so
      // the untiered user survives.
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockImplementation(() => {
          const filter = mockFind.mock.calls[0]?.[0] as {
            accountStatus?: { $ne?: string };
            reputationTier?: { $ne?: string };
          };
          const acctNe = filter.accountStatus?.$ne;
          const tierNe = filter.reputationTier?.$ne;
          return Promise.resolve(
            pool.filter(
              (u) =>
                u.accountStatus !== acctNe &&
                (u as { reputationTier?: string }).reputationTier !== tierNe
            )
          );
        }),
      };
      mockFind.mockReturnValue(mockQuery);

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      const responseJson = mockResponse.json as jest.Mock;
      const returned = responseJson.mock.calls[0]?.[0]?.data as Array<{ username: string }>;
      const usernames = returned.map((u) => u.username);
      expect(usernames).toContain('clean_match');
      expect(usernames).toContain('trusted_match');
      expect(usernames).not.toContain('archived_match');
      expect(usernames).not.toContain('restricted_match');
    });

    it('never projects the searched users\' email addresses', async () => {
      mockRequest.body = { query: 'test' };

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      mockFind.mockReturnValue(mockQuery);

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // This projection used to include `email`, so a public user search
      // returned every match's email address. The shared projection is
      // inclusion-only: `email` is simply never loaded.
      const projection = mockQuery.select.mock.calls[0]?.[0] as string;
      expect(projection.split(' ')).not.toContain('email');
    });

    it('strips a single leading @ so a Bluesky handle matches the stored username', async () => {
      // The stored atproto username has no leading @; the client query does.
      mockRequest.body = { query: '@adamrbjack.bsky.social@bsky.social' };

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      mockFind.mockReturnValue(mockQuery);

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // `sanitizeSearchQuery` is mocked as identity, so the `$regex` value is the
      // stripped query — the leading @ is gone, matching the stored username.
      const filter = mockFind.mock.calls[0]?.[0] as { $or?: Array<{ username?: { $regex?: string } }> };
      expect(filter.$or?.[0]?.username?.$regex).toBe('adamrbjack.bsky.social@bsky.social');
    });

    it('strips only the leading @ — a Mastodon @user@host matches user@host', async () => {
      mockRequest.body = { query: '@user@mastodon.social' };

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      mockFind.mockReturnValue(mockQuery);

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // One leading @ removed; the mid-string @ (the user@host separator) stays.
      const filter = mockFind.mock.calls[0]?.[0] as { $or?: Array<{ username?: { $regex?: string } }> };
      expect(filter.$or?.[0]?.username?.$regex).toBe('user@mastodon.social');
    });

    it('does NOT strip a mid-string @ when there is no leading @', async () => {
      mockRequest.body = { query: 'user@mastodon.social' };

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      mockFind.mockReturnValue(mockQuery);

      await usersController.searchUsers(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // A query with no leading @ is unchanged — the internal @ is preserved.
      const filter = mockFind.mock.calls[0]?.[0] as { $or?: Array<{ username?: { $regex?: string } }> };
      expect(filter.$or?.[0]?.username?.$regex).toBe('user@mastodon.social');
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
