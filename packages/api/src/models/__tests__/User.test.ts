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
