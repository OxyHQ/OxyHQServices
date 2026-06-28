/**
 * Unit tests for the repo-log read service (F0.2 / F5a public node log).
 *
 *  - `getLogSince` filters `seq > since`, orders ascending by `seq`, clamps the
 *    limit to MAX (500), and returns the bare envelopes.
 *  - `getHead` returns the O(1) RepoHead, or null.
 *  - `resolveCursorSeq` maps a `recordId` cursor to its `seq`, or null.
 *
 * The SignedRecord + RepoHead models are mocked — no DB.
 */

const mockSrFind = jest.fn();
const mockSrFindOne = jest.fn();
const mockHeadFindOne = jest.fn();

jest.mock('../../models/SignedRecord', () => ({
  __esModule: true,
  default: {
    find: (...args: unknown[]) => mockSrFind(...args),
    findOne: (...args: unknown[]) => mockSrFindOne(...args),
  },
}));
jest.mock('../../models/RepoHead', () => ({
  __esModule: true,
  default: { findOne: (...args: unknown[]) => mockHeadFindOne(...args) },
}));

import { getLogSince, getHead, resolveCursorSeq } from '../repoLog.service';

const USER_ID = '507f1f77bcf86cd799439011';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getLogSince', () => {
  it('filters seq > since, orders ascending, and returns bare envelopes', async () => {
    let capturedLimit = -1;
    mockSrFind.mockReturnValue({
      sort: (sortArg: unknown) => {
        expect(sortArg).toEqual({ seq: 1 });
        return {
          limit: (n: number) => {
            capturedLimit = n;
            return { lean: () => Promise.resolve([{ envelope: { seq: 3 } }, { envelope: { seq: 4 } }]) };
          },
        };
      },
    });

    const envelopes = await getLogSince(USER_ID, 2, 50);

    expect(mockSrFind).toHaveBeenCalledWith({ userId: USER_ID, seq: { $gt: 2 } });
    expect(capturedLimit).toBe(50);
    expect(envelopes).toEqual([{ seq: 3 }, { seq: 4 }]);
  });

  it('clamps the limit to the 500 ceiling', async () => {
    let capturedLimit = -1;
    mockSrFind.mockReturnValue({
      sort: () => ({ limit: (n: number) => { capturedLimit = n; return { lean: () => Promise.resolve([]) }; } }),
    });

    await getLogSince(USER_ID, -1, 10_000);
    expect(capturedLimit).toBe(500);
  });

  it('defaults the limit to 100 when omitted', async () => {
    let capturedLimit = -1;
    mockSrFind.mockReturnValue({
      sort: () => ({ limit: (n: number) => { capturedLimit = n; return { lean: () => Promise.resolve([]) }; } }),
    });

    await getLogSince(USER_ID, -1);
    expect(capturedLimit).toBe(100);
  });
});

describe('getHead', () => {
  it('returns the chain head', async () => {
    mockHeadFindOne.mockReturnValue({ lean: () => Promise.resolve({ seq: 5, headRecordId: 'abc', recordCount: 6 }) });
    expect(await getHead(USER_ID)).toEqual({ seq: 5, headRecordId: 'abc', recordCount: 6 });
  });

  it('returns null when there is no chain', async () => {
    mockHeadFindOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    expect(await getHead(USER_ID)).toBeNull();
  });
});

describe('resolveCursorSeq', () => {
  it('maps a recordId to its seq', async () => {
    mockSrFindOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ seq: 7 }) }) });
    expect(await resolveCursorSeq(USER_ID, 'rid')).toBe(7);
    expect(mockSrFindOne).toHaveBeenCalledWith({ userId: USER_ID, recordId: 'rid' });
  });

  it('returns null for an unknown recordId', async () => {
    mockSrFindOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
    expect(await resolveCursorSeq(USER_ID, 'nope')).toBeNull();
  });
});
