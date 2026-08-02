// The global jest.setup.cjs mocks `mongoose` wholesale; the real User schema —
// defaults, paths, virtuals — only builds against the actual module, so restore
// it for this suite.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import { User } from '../User';

/**
 * Account languages live on `User.languages` (ordered BCP-47 locales, PRIMARY
 * first) — the ONLY language field. There is no singular `language` field and no
 * sync hook; normalization/validation happen at the write boundary. These tests
 * pin the schema shape: the default and the absence of the legacy field.
 */
describe('User model — account languages field', () => {
  it('defaults a brand-new account to ["en-US"]', () => {
    const user = new User({ username: 'lang-default' });

    expect(user.languages?.map(String)).toEqual(['en-US']);
  });

  it('stores an explicit languages array verbatim (no model-level rewrite)', () => {
    const user = new User({ username: 'lang-explicit', languages: ['es-ES', 'en-US'] });

    expect(user.languages?.map(String)).toEqual(['es-ES', 'en-US']);
  });

  it('has no top-level singular `language` schema path', () => {
    // The account-language field was removed; only the unrelated nested
    // `userPreferences.language` app-preference remains.
    expect(User.schema.path('language')).toBeUndefined();
    expect(User.schema.path('userPreferences.language')).toBeDefined();
  });
});
