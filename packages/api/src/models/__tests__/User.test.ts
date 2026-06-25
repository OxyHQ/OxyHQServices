// The global jest.setup.cjs mocks `mongoose` wholesale; the real User schema —
// virtuals, hooks, the `color` validator under test — only builds against the
// actual module, so restore it for this suite.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import { User } from '../User';

describe('User model color validation', () => {
  it('accepts named color presets', () => {
    const user = new User({ username: 'named-color-user', color: 'teal' });

    expect(user.validateSync()?.errors.color).toBeUndefined();
  });

  it('accepts legacy hex colors so existing users can save unrelated changes', () => {
    const user = new User({ username: 'legacy-color-user', color: '#4285f4' });
    user.name = { first: 'Legacy' };

    expect(user.validateSync()?.errors.color).toBeUndefined();
  });

  it('rejects arbitrary non-preset color strings', () => {
    const user = new User({ username: 'invalid-color-user', color: 'not-a-color' });

    expect(user.validateSync()?.errors.color).toBeDefined();
  });
});
