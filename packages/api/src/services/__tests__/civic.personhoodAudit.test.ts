/**
 * Random personhood audit tests (civic / Fase 3).
 *
 * `sweepPersonhoodAudits` samples real persons and opens a jury request for each
 * (reusing the Fase 2 `openValidationRequest`), skipping subjects with an audit
 * already open. `resolvePersonhoodAuditOutcome` rewards the majority and, on a
 * `rejected` (fake) outcome, runs the staking slash cascade. The validator jury
 * + personhood service + reputation award are mocked; `did.service` runs for real.
 */

const mockOpen = jest.fn();
const mockSlashVouchers = jest.fn();
const mockRecompute = jest.fn();
const mockAward = jest.fn();
const mockCount = jest.fn();
const mockAggregate = jest.fn();
const mockReqFind = jest.fn();

jest.mock('../civic/validator.service', () => ({ openValidationRequest: (...a: unknown[]) => mockOpen(...a) }));
jest.mock('../civic/personhood.service', () => ({
  slashVouchersForFakeSubject: (...a: unknown[]) => mockSlashVouchers(...a),
  recomputePersonhood: (...a: unknown[]) => mockRecompute(...a),
}));
jest.mock('../reputation.service', () => ({ reputationService: { award: (...a: unknown[]) => mockAward(...a) } }));
jest.mock('../../models/PersonhoodStatus', () => ({
  __esModule: true,
  default: {
    countDocuments: (...a: unknown[]) => mockCount(...a),
    aggregate: (...a: unknown[]) => mockAggregate(...a),
  },
}));
jest.mock('../../models/ValidationRequest', () => ({
  __esModule: true,
  default: { find: (...a: unknown[]) => mockReqFind(...a) },
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import {
  sweepPersonhoodAudits,
  resolvePersonhoodAuditOutcome,
  openPersonhoodAudit,
} from '../civic/personhoodAudit.service';
import { buildUserDid } from '../did.service';
import type { IValidationRequest } from '../../models/ValidationRequest';

const U1 = '1'.repeat(24);
const U2 = '2'.repeat(24);

function selectLean(data: unknown) {
  return { select: () => ({ lean: async () => data }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOpen.mockResolvedValue({ _id: { toString: () => 'req-x' } });
  mockSlashVouchers.mockResolvedValue(2);
  mockRecompute.mockResolvedValue({});
  mockAward.mockResolvedValue({});
  mockReqFind.mockReturnValue(selectLean([])); // no open audits by default
});

describe('openPersonhoodAudit', () => {
  it('opens a personhood_audit jury request with the subject DID payload', async () => {
    await openPersonhoodAudit(U1);
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen.mock.calls[0][0]).toMatchObject({
      subjectUserId: U1,
      actionType: 'personhood_audit',
      sourceActionId: `personhood_audit:${U1}`,
      payload: { kind: 'personhood_audit', subjectDid: buildUserDid(U1) },
    });
  });
});

describe('sweepPersonhoodAudits', () => {
  it('opens an audit for each sampled real person', async () => {
    mockCount.mockResolvedValue(10);
    mockAggregate.mockResolvedValue([{ userId: U1 }, { userId: U2 }]);
    const opened = await sweepPersonhoodAudits();
    expect(opened).toBe(2);
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });

  it('skips a subject that already has an open audit', async () => {
    mockCount.mockResolvedValue(10);
    mockAggregate.mockResolvedValue([{ userId: U1 }, { userId: U2 }]);
    mockReqFind.mockReturnValue(selectLean([{ subjectUserId: U1 }]));
    const opened = await sweepPersonhoodAudits();
    expect(opened).toBe(1);
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen.mock.calls[0][0].subjectUserId).toBe(U2);
  });

  it('is a no-op when there are no real persons', async () => {
    mockCount.mockResolvedValue(0);
    const opened = await sweepPersonhoodAudits();
    expect(opened).toBe(0);
    expect(mockAggregate).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });
});

describe('resolvePersonhoodAuditOutcome', () => {
  const request = {
    _id: { toString: () => 'req-1' },
    subjectUserId: { toString: () => U1 },
  } as unknown as IValidationRequest;

  it('on a rejected (fake) outcome, rewards the majority and runs the slash cascade', async () => {
    await resolvePersonhoodAuditOutcome(request, 'rejected', ['j1', 'j2']);
    expect(mockSlashVouchers).toHaveBeenCalledWith(U1, expect.any(String));
    const correct = mockAward.mock.calls.filter((c) => c[0].actionType === 'validation_correct');
    expect(correct).toHaveLength(2);
  });

  it('on a validated outcome, re-affirms the subject without slashing', async () => {
    await resolvePersonhoodAuditOutcome(request, 'validated', ['j1']);
    expect(mockSlashVouchers).not.toHaveBeenCalled();
    expect(mockRecompute).toHaveBeenCalledWith(U1);
  });
});
