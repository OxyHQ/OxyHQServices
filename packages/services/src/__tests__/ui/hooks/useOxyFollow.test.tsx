import { renderHook } from '@testing-library/react-native';
import { useFollowUser } from '../../../ui/hooks/useFollow';
import { OxyContextProvider } from '../../../ui/context/OxyContext';
import { initializeOxyStore } from '../../../stores';
import React from 'react';

// Mock OxyServices
const mockOxyServices = {
  followUser: jest.fn().mockResolvedValue(undefined),
  unfollowUser: jest.fn().mockResolvedValue(undefined),
  getFollowStatus: jest.fn().mockResolvedValue({ isFollowing: false }),
  setTokens: jest.fn(),
  getAccessToken: jest.fn().mockReturnValue('mock-token'),
  getRefreshToken: jest.fn().mockReturnValue('mock-refresh-token'),
  validate: jest.fn().mockResolvedValue(true),
};

const createWrapper = () => {
  // Initialize store before rendering
  initializeOxyStore(mockOxyServices);
  
  return ({ children }: { children: React.ReactNode }) => (
    <OxyContextProvider>
      {children}
    </OxyContextProvider>
  );
};

describe('useFollow (Zustand-based)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should provide follow functionality with Zustand store', () => {
    const wrapper = createWrapper();

    const { result } = renderHook(() => useFollowUser('user1'), { wrapper });

    // Should have the core follow functionality
    expect(result.current).toHaveProperty('isFollowing');
    expect(result.current).toHaveProperty('isLoading');
    expect(result.current).toHaveProperty('error');
    expect(result.current).toHaveProperty('toggleFollow');
    expect(result.current).toHaveProperty('followUser');
    expect(result.current).toHaveProperty('unfollowUser');

    // Initial state should be correct
    expect(result.current.isFollowing).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  test('should work without Redux - pure Zustand implementation', () => {
    // This test verifies that we don't need Redux anymore
    const wrapper = createWrapper();

    const { result } = renderHook(() => useFollowUser('user2'), { wrapper });

    // Should work without any Redux setup
    expect(result.current.isFollowing).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(typeof result.current.toggleFollow).toBe('function');
  });
});