/**
 * Identity binding tests — the primitive "no binding proof, no effect" rests on.
 *
 * Two properties carry the weight, and neither is obvious from reading the code:
 *
 *  - `verifiedAt` IS DERIVED, NEVER ACCEPTED. An application cannot make its
 *    binding look older than its evidence, because the only two sources are an
 *    `AppGrant` Oxy itself wrote and the current clock. If an application could
 *    supply the instant, it could retroactively cover any past action.
 *  - A REFRESH NEVER MOVES `verifiedAt` FORWARD. Re-registering must not
 *    retroactively invalidate the reported actions the original binding already
 *    covered — a subtle way to lose the ability to penalise a real offence by
 *    doing something entirely routine.
 *
 * The proof itself (`validateSessionToken`) is mocked: it is the existing session
 * layer with its own tests, and what matters here is that a FAILED proof produces
 * no binding at all.
 */

import { Types } from 'mongoose';

const mockValidateSessionToken = jest.fn();
jest.mock('../../middleware/authUtils', () => ({
  validateSessionToken: (...args: unknown[]) => mockValidateSessionToken(...args),
}));

interface AnyDoc {
  _id: Types.ObjectId;
  [key: string]: unknown;
}

const bindingStore = { docs: [] as AnyDoc[] };
const grantStore = { docs: [] as AnyDoc[] };

function matches(doc: AnyDoc, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => String(doc[key]) === String(expected));
}

function attachSave(doc: AnyDoc, store: { docs: AnyDoc[] }): AnyDoc {
  if (typeof doc.save === 'function') return doc;
  Object.defineProperty(doc, 'save', {
    enumerable: false,
    configurable: true,
    value: async () => {
      const idx = store.docs.findIndex((d) => d._id.equals(doc._id));
      if (idx === -1) store.docs.push(doc);
      else store.docs[idx] = doc;
      return doc;
    },
  });
  return doc;
}

function makeModel(store: { docs: AnyDoc[] }) {
  return {
    async create(data: Record<string, unknown>) {
      const doc = attachSave(
        { _id: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date(), ...data },
        store
      );
      store.docs.push(doc);
      return doc;
    },
    findOne(query: Record<string, unknown> = {}) {
      const found = store.docs.find((d) => matches(d, query));
      const doc = found ? attachSave(found, store) : null;
      const chain = {
        select: () => chain,
        lean: async () => doc,
        then: (
          onFulfilled: (value: AnyDoc | null) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => Promise.resolve(doc).then(onFulfilled, onRejected),
      };
      return chain;
    },
  };
}

jest.mock('../../models/IdentityBinding', () => ({
  __esModule: true,
  IdentityBinding: makeModel(bindingStore),
  default: makeModel(bindingStore),
}));
jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: makeModel(grantStore),
  default: makeModel(grantStore),
}));

import {
  registerIdentityBinding,
  resolveBindingProof,
} from '../identityBinding.service';

const APP_ID = new Types.ObjectId().toString();
const OTHER_APP_ID = new Types.ObjectId().toString();
const USER_ID = new Types.ObjectId().toString();
const OTHER_USER_ID = new Types.ObjectId().toString();
const CREDENTIAL_ID = new Types.ObjectId().toString();

const GRANT_AT = new Date('2026-01-01T00:00:00.000Z');

beforeEach(() => {
  bindingStore.docs = [];
  grantStore.docs = [];
  jest.clearAllMocks();
  mockValidateSessionToken.mockResolvedValue({ _id: USER_ID });
});

describe('registerIdentityBinding', () => {
  it('refuses to create anything when the user proof does not resolve', async () => {
    mockValidateSessionToken.mockResolvedValue(null);
    await expect(
      registerIdentityBinding({
        applicationId: APP_ID,
        localPrincipalId: 'local-1',
        userProofToken: 'garbage',
      })
    ).rejects.toThrow(/user proof token/i);
    expect(bindingStore.docs).toHaveLength(0);
  });

  it("prefers Oxy's own consent record over the current moment", async () => {
    // An `AppGrant` predates the registration call and the application asserted
    // none of it, so it is both stronger evidence and covers more of the past.
    grantStore.docs.push({
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(USER_ID),
      applicationId: new Types.ObjectId(APP_ID),
      firstGrantedAt: GRANT_AT,
    });

    const binding = await registerIdentityBinding({
      applicationId: APP_ID,
      credentialId: CREDENTIAL_ID,
      localPrincipalId: 'local-1',
      userProofToken: 'valid',
    });

    expect(binding.bindingType).toBe('oauth_grant');
    expect(binding.verifiedAt).toEqual(GRANT_AT);
  });

  it('falls back to a session proof when no grant exists', async () => {
    // Trusted first-party applications are auto-approved at authorize time and
    // record NO grant. Without this path, the applications closest to Oxy would
    // be the only ones unable to prove anything.
    const before = Date.now();
    const binding = await registerIdentityBinding({
      applicationId: APP_ID,
      localPrincipalId: 'local-1',
      userProofToken: 'valid',
    });

    expect(binding.bindingType).toBe('session_proof');
    expect(binding.verifiedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('a refresh never moves verifiedAt forward', async () => {
    // Re-registering must not retroactively invalidate the reported actions the
    // original binding already covered.
    grantStore.docs.push({
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(USER_ID),
      applicationId: new Types.ObjectId(APP_ID),
      firstGrantedAt: GRANT_AT,
    });
    const first = await registerIdentityBinding({
      applicationId: APP_ID,
      localPrincipalId: 'local-1',
      userProofToken: 'valid',
    });
    expect(first.verifiedAt).toEqual(GRANT_AT);

    // Now the grant is gone (revoked and re-consented, say) so the only available
    // proof is "now" — which must NOT overwrite the earlier instant.
    grantStore.docs = [];
    const refreshed = await registerIdentityBinding({
      applicationId: APP_ID,
      localPrincipalId: 'local-1',
      userProofToken: 'valid',
    });

    expect(refreshed._id.toString()).toBe(first._id.toString());
    expect(refreshed.verifiedAt).toEqual(GRANT_AT);
    expect(bindingStore.docs).toHaveLength(1);
  });

  it('rebinding a local principal to a different person revokes rather than overwrites', async () => {
    // A past effect references the old row, and its original `verifiedAt` is what
    // made that effect legitimate — so the row has to survive.
    const first = await registerIdentityBinding({
      applicationId: APP_ID,
      localPrincipalId: 'local-1',
      userProofToken: 'valid',
    });

    mockValidateSessionToken.mockResolvedValue({ _id: OTHER_USER_ID });
    const second = await registerIdentityBinding({
      applicationId: APP_ID,
      localPrincipalId: 'local-1',
      userProofToken: 'valid-other',
    });

    expect(second._id.toString()).not.toBe(first._id.toString());
    expect(bindingStore.docs).toHaveLength(2);
    const old = bindingStore.docs.find((d) => d._id.equals(first._id));
    expect(old?.status).toBe('revoked');
    expect(old?.revokedAt).toBeDefined();
    expect(old?.verifiedAt).toEqual(first.verifiedAt);
  });
});

describe('resolveBindingProof', () => {
  const ACTION_AT = new Date('2026-06-01T00:00:00.000Z');

  /** Seed an active binding verified before the reported action. */
  async function seedBinding(overrides: Record<string, unknown> = {}) {
    grantStore.docs.push({
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(USER_ID),
      applicationId: new Types.ObjectId(APP_ID),
      firstGrantedAt: GRANT_AT,
    });
    const binding = await registerIdentityBinding({
      applicationId: APP_ID,
      localPrincipalId: 'local-1',
      userProofToken: 'valid',
    });
    Object.assign(binding, overrides);
    return binding;
  }

  it('accepts a binding that was verified before the action', async () => {
    const binding = await seedBinding();
    const result = await resolveBindingProof({
      applicationId: APP_ID,
      bindingProofId: binding._id.toString(),
      principalId: USER_ID,
      occurredAt: ACTION_AT,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a binding verified at exactly the moment of the action', async () => {
    // "At or before" — the boundary is inclusive, because a binding established
    // during the reported action is a valid proof of presence.
    const binding = await seedBinding({ verifiedAt: ACTION_AT });
    const result = await resolveBindingProof({
      applicationId: APP_ID,
      bindingProofId: binding._id.toString(),
      principalId: USER_ID,
      occurredAt: ACTION_AT,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a binding verified one millisecond after the action', async () => {
    const binding = await seedBinding({ verifiedAt: new Date(ACTION_AT.getTime() + 1) });
    const result = await resolveBindingProof({
      applicationId: APP_ID,
      bindingProofId: binding._id.toString(),
      principalId: USER_ID,
      occurredAt: ACTION_AT,
    });
    expect(result).toEqual({ ok: false, reason: 'binding_after_action' });
  });

  it('rejects a binding that resolves to another person', async () => {
    const binding = await seedBinding();
    const result = await resolveBindingProof({
      applicationId: APP_ID,
      bindingProofId: binding._id.toString(),
      principalId: OTHER_USER_ID,
      occurredAt: ACTION_AT,
    });
    expect(result).toEqual({ ok: false, reason: 'binding_principal_mismatch' });
  });

  it('rejects a revoked binding', async () => {
    const binding = await seedBinding({ status: 'revoked' });
    const result = await resolveBindingProof({
      applicationId: APP_ID,
      bindingProofId: binding._id.toString(),
      principalId: USER_ID,
      occurredAt: ACTION_AT,
    });
    expect(result).toEqual({ ok: false, reason: 'binding_revoked' });
  });

  it("does not find another application's binding", async () => {
    // Scoped lookup: an emitter cannot borrow a proof from a tenant it does not
    // speak for, and from this application's perspective there IS no such binding.
    const binding = await seedBinding();
    const result = await resolveBindingProof({
      applicationId: OTHER_APP_ID,
      bindingProofId: binding._id.toString(),
      principalId: USER_ID,
      occurredAt: ACTION_AT,
    });
    expect(result).toEqual({ ok: false, reason: 'no_binding_proof' });
  });

  it('rejects a malformed binding id without throwing', async () => {
    const result = await resolveBindingProof({
      applicationId: APP_ID,
      bindingProofId: 'not-an-object-id',
      principalId: USER_ID,
      occurredAt: ACTION_AT,
    });
    expect(result).toEqual({ ok: false, reason: 'no_binding_proof' });
  });

  it('rejects a binding id that does not exist', async () => {
    const result = await resolveBindingProof({
      applicationId: APP_ID,
      bindingProofId: new Types.ObjectId().toString(),
      principalId: USER_ID,
      occurredAt: ACTION_AT,
    });
    expect(result).toEqual({ ok: false, reason: 'no_binding_proof' });
  });
});
