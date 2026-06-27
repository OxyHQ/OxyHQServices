/**
 * Sybil heuristics tests (civic / Fase 3).
 *
 * `computeSybilPenalty` is driven with PersonhoodVouch + session-fingerprint
 * reads mocked, so the two heuristics are exercised in isolation:
 *  - SHARED DEVICE/IP CLUSTER — vouchers that share a fingerprint with one
 *    another raise the penalty.
 *  - VOUCH-RING DENSITY — a reciprocal (subject vouches back) edge raises it.
 * No vouchers ⇒ no penalty.
 */

const mockFingerprints = jest.fn();
const mockVouchFind = jest.fn();

jest.mock('../civic/graphExclusion', () => ({
  sessionFingerprints: (...a: unknown[]) => mockFingerprints(...a),
}));
jest.mock('../../models/PersonhoodVouch', () => ({
  __esModule: true,
  default: { find: (...a: unknown[]) => mockVouchFind(...a) },
}));

import { computeSybilPenalty } from '../civic/sybil.service';
import {
  SYBIL_SHARED_FINGERPRINT_WEIGHT,
  SYBIL_VOUCH_RING_WEIGHT,
} from '../../utils/civic.constants';

const SUBJECT = 's'.repeat(24);
const A = 'a'.repeat(24);
const B = 'b'.repeat(24);

/** A `.select().limit().lean()` chain returning `data`. */
function chain(data: unknown) {
  return { select: () => ({ limit: () => ({ lean: async () => data }) }) };
}

interface VouchQuery {
  subjectUserId?: unknown;
  voucherUserId?: unknown;
  status?: string;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no overlapping fingerprints for any account.
  mockFingerprints.mockImplementation(async (id: string) => ({
    devices: new Set([`dev-${id}`]),
    ips: new Set([`ip-${id}`]),
  }));
});

describe('computeSybilPenalty', () => {
  it('returns the zero signal when the subject has no active vouchers', async () => {
    mockVouchFind.mockReturnValue(chain([]));
    const signal = await computeSybilPenalty(SUBJECT);
    expect(signal).toEqual({ penalty: 0, sharedFingerprintFraction: 0, ringDensity: 0 });
  });

  it('penalises vouchers that share a device fingerprint with one another', async () => {
    mockVouchFind.mockImplementation((q: VouchQuery) => {
      // activeVoucherIds — two vouchers A, B.
      if (q.subjectUserId && q.status === 'active' && q.voucherUserId === undefined) {
        return chain([{ voucherUserId: A }, { voucherUserId: B }]);
      }
      // ring: subject's outgoing vouches — none.
      return chain([]);
    });
    // A and B share the same device → both are "clustered".
    mockFingerprints.mockImplementation(async (id: string) => {
      if (id === A || id === B) {
        return { devices: new Set(['shared-device']), ips: new Set([`ip-${id}`]) };
      }
      return { devices: new Set([`dev-${id}`]), ips: new Set([`ip-${id}`]) };
    });

    const signal = await computeSybilPenalty(SUBJECT);
    expect(signal.sharedFingerprintFraction).toBe(1);
    expect(signal.ringDensity).toBe(0);
    expect(signal.penalty).toBeCloseTo(SYBIL_SHARED_FINGERPRINT_WEIGHT, 5);
  });

  it('penalises a reciprocal vouch ring (subject vouches a voucher back)', async () => {
    mockVouchFind.mockImplementation((q: VouchQuery) => {
      if (q.subjectUserId && q.status === 'active' && q.voucherUserId === undefined) {
        return chain([{ voucherUserId: A }]); // A vouches the subject
      }
      if (q.voucherUserId === SUBJECT) {
        return chain([{ subjectUserId: A }]); // the subject vouches A back (2-cycle)
      }
      return chain([]); // no 3-cycle bridges
    });

    const signal = await computeSybilPenalty(SUBJECT);
    expect(signal.sharedFingerprintFraction).toBe(0);
    expect(signal.ringDensity).toBe(1);
    expect(signal.penalty).toBeCloseTo(SYBIL_VOUCH_RING_WEIGHT, 5);
  });

  it('returns a zero penalty for independent vouchers with no rings', async () => {
    mockVouchFind.mockImplementation((q: VouchQuery) => {
      if (q.subjectUserId && q.status === 'active' && q.voucherUserId === undefined) {
        return chain([{ voucherUserId: A }, { voucherUserId: B }]);
      }
      return chain([]);
    });
    const signal = await computeSybilPenalty(SUBJECT);
    expect(signal.penalty).toBe(0);
  });
});
