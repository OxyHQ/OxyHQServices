import { renderHook } from '@testing-library/react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { useOxyFollow } from '../../../ui/hooks/useOxyFollow';
import { setupOxyStore } from '../../../ui/store/setupOxyStore';
import { OxyContextProvider } from '../../../ui/context/OxyContext';
import React from 'react';

// Mock OxyServices
const mockOxyServices = {
  getFollowStatus: jest.fn(),
  followUser: jest.fn(),
  unfollowUser: jest.fn(),
};

const createTestStore = () => {
  return configureStore({
    reducer: {
      ...setupOxyStore(),
    },
  });
};

const createWrapper = (store: ReturnType<typeof createTestStore>) => {
  return ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>
      <OxyContextProvider oxyServices={mockOxyServices}>
        {children}
      </OxyContextProvider>
    </Provider>
  );
};

describe('useOxyFollow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should work with external store containing Oxy reducers', () => {
    const store = createTestStore();
    const wrapper = createWrapper(store);

    const { result } = renderHook(() => useOxyFollow('user1'), { wrapper });

    expect(result.current).toHaveProperty('isFollowing');
    expect(result.current).toHaveProperty('isLoading');
    expect(result.current).toHaveProperty('error');
    expect(result.current).toHaveProperty('toggleFollow');
    expect(result.current).toHaveProperty('setFollowStatus');
    expect(result.current).toHaveProperty('fetchStatus');
    expect(result.current).toHaveProperty('clearError');
  });

  test('should support multiple users mode', () => {
    const store = createTestStore();
    const wrapper = createWrapper(store);

    const { result } = renderHook(() => useOxyFollow(['user1', 'user2']), { wrapper });

    expect(result.current).toHaveProperty('followData');
    expect(result.current).toHaveProperty('toggleFollowForUser');
    expect(result.current).toHaveProperty('setFollowStatusForUser');
    expect(result.current).toHaveProperty('fetchStatusForUser');
    expect(result.current).toHaveProperty('fetchAllStatuses');
    expect(result.current).toHaveProperty('clearErrorForUser');
    expect(result.current).toHaveProperty('isAnyLoading');
    expect(result.current).toHaveProperty('hasAnyError');
    expect(result.current).toHaveProperty('allFollowing');
    expect(result.current).toHaveProperty('allNotFollowing');
  });

  test('should integrate with custom app reducers', () => {
    const store = configureStore({
      reducer: {
        ...setupOxyStore(),
        customApp: (state = { feature: 'enabled' }) => state,
      },
    });

    const wrapper = createWrapper(store);

    const { result } = renderHook(() => useOxyFollow('user1'), { wrapper });

    // Should still work with Oxy features
    expect(result.current.isFollowing).toBe(false);
    expect(result.current.isLoading).toBe(false);

    // Custom app state should also be accessible in the store
    const state = store.getState();
    expect(state.customApp.feature).toBe('enabled');
  });
});