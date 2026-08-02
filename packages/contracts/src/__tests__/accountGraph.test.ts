import {
  ACCOUNT_KINDS,
  CHILD_ACCOUNT_KINDS,
  createAccountRequestSchema,
  isAccountKind,
  isActAsEligibleKind,
  organizationCategorySchema,
} from '../accountGraph';
import { userResponseSchema } from '../userResponse';

describe('@oxyhq/contracts account kinds', () => {
  it('carries channel as a child kind, and personal as the only root', () => {
    expect([...ACCOUNT_KINDS]).toEqual([
      'personal',
      'organization',
      'project',
      'bot',
      'channel',
    ]);
    expect([...CHILD_ACCOUNT_KINDS]).toEqual(['organization', 'project', 'bot', 'channel']);
    expect(CHILD_ACCOUNT_KINDS).not.toContain('personal');
  });

  it('accepts a channel as a create-account kind', () => {
    const parsed = createAccountRequestSchema.safeParse({
      kind: 'channel',
      username: 'daily-news',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects organizationCategory on a channel', () => {
    const parsed = createAccountRequestSchema.safeParse({
      kind: 'channel',
      username: 'daily-news',
      organizationCategory: 'agency',
    });
    expect(parsed.success).toBe(false);
  });

  /**
   * The act-as partition, stated as a full truth table over EVERY kind rather
   * than a spot check — the failure this guards is a new kind silently landing
   * on the eligible side of a `kind === 'personal'` test.
   */
  it('admits only organization/project/bot to act-as', () => {
    const verdicts = Object.fromEntries(
      ACCOUNT_KINDS.map((kind) => [kind, isActAsEligibleKind(kind)])
    );
    expect(verdicts).toEqual({
      personal: false,
      organization: true,
      project: true,
      bot: true,
      channel: false,
    });
  });

  it('treats a missing kind as ineligible', () => {
    expect(isActAsEligibleKind(undefined)).toBe(false);
    expect(isActAsEligibleKind(null)).toBe(false);
  });

  it('narrows only real kinds', () => {
    for (const kind of ACCOUNT_KINDS) {
      expect(isAccountKind(kind)).toBe(true);
    }
    for (const notAKind of ['', 'Channel', 'user', 'local', null, undefined, 3, {}]) {
      expect(isAccountKind(notAKind)).toBe(false);
    }
  });

  /**
   * `kind` and `type` are different axes that coexist — `type` says where an
   * account lives and how it is driven, `kind` says what it is. Neither value
   * belongs in the other's vocabulary, and confusing them is the likeliest way
   * a consumer misreads a channel.
   */
  it('shares no value with the federation type vocabulary', () => {
    const federationTypes = ['local', 'federated', 'agent', 'automated'];
    for (const kind of ACCOUNT_KINDS) {
      expect(federationTypes).not.toContain(kind);
    }
  });

  it('accepts an explicit displayName when creating an account', () => {
    const parsed = createAccountRequestSchema.safeParse({
      kind: 'channel',
      username: 'notas-de-nate',
      name: { displayName: 'Notas de Nate' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name?.displayName).toBe('Notas de Nate');
      // The title does NOT land in the given-name field.
      expect(parsed.data.name?.first).toBeUndefined();
    }
  });
});

describe('@oxyhq/contracts accountGraph', () => {
  it('accepts organizationCategory only for kind organization', () => {
    const ok = createAccountRequestSchema.safeParse({
      kind: 'organization',
      username: 'acme-realty',
      organizationCategory: 'agency',
    });
    expect(ok.success).toBe(true);

    const bad = createAccountRequestSchema.safeParse({
      kind: 'project',
      username: 'my-project',
      organizationCategory: 'agency',
    });
    expect(bad.success).toBe(false);
  });

  it('parses organizationCategory on user responses', () => {
    const parsed = userResponseSchema.safeParse({
      id: '507f1f77bcf86cd799439011',
      username: 'acme',
      name: { displayName: 'Acme Realty' },
      organizationCategory: 'agency',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.organizationCategory).toBe('agency');
    }
  });

  it('rejects unknown organization categories', () => {
    const parsed = organizationCategorySchema.safeParse('broker');
    expect(parsed.success).toBe(false);
  });
});
