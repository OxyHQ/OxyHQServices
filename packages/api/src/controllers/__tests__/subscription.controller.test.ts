const mockFindOneAndUpdate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockInvalidate = jest.fn();

jest.mock('../../models/Subscription', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
  },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args),
  },
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: (...args: unknown[]) => mockInvalidate(...args) },
}));

jest.mock('../../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth';
import { cancelSubscription } from '../subscription.controller';

describe('cancelSubscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('revokes analyticsSharing and busts user cache', async () => {
    const subscription = { userId: 'user-1', status: 'canceled' };
    mockFindOneAndUpdate.mockResolvedValue(subscription);
    mockFindByIdAndUpdate.mockResolvedValue({});

    const json = jest.fn();
    const req = {
      params: { userId: 'user-1' },
      user: { _id: { toString: () => 'user-1' } },
    } as unknown as AuthRequest;
    const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;

    await cancelSubscription(req, res);

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('user-1', {
      $set: { 'privacySettings.analyticsSharing': false },
    });
    expect(mockInvalidate).toHaveBeenCalledWith('user-1');
    expect(json).toHaveBeenCalledWith(subscription);
  });
});
