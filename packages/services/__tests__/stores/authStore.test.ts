import { useAuthStore } from '../../src/ui/stores/authStore';

describe('authStore user identity normalization', () => {
  afterEach(() => {
    useAuthStore.getState().logout();
  });

  it('stores a stable id when the API user only carries _id', () => {
    const user = {
      _id: 'user_1',
      username: 'nate',
      publicKey: 'pub_1',
    };

    useAuthStore.getState().loginSuccess(user);

    expect(useAuthStore.getState().user?.id).toBe('user_1');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});
