import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { FollowButton } from '../../../ui/components/FollowButton';
import { OxyContextProvider } from '../../../ui/context/OxyContext';
import { OxyServices } from '../../../core';

// Mock the OxyServices
const mockOxyServices = {
  followUser: jest.fn(),
  unfollowUser: jest.fn(),
} as unknown as OxyServices;

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <OxyContextProvider oxyServices={mockOxyServices}>
    {children}
  </OxyContextProvider>
);

describe('FollowButton API Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call followUser API when follow button is pressed', async () => {
    const mockResponse = { success: true, message: 'Successfully followed user' };
    (mockOxyServices.followUser as jest.Mock).mockResolvedValue(mockResponse);

    const { getByText } = render(
      <TestWrapper>
        <FollowButton userId="test-user-123" initiallyFollowing={false} />
      </TestWrapper>
    );

    const followButton = getByText('Follow');
    fireEvent.press(followButton);

    await waitFor(() => {
      expect(mockOxyServices.followUser).toHaveBeenCalledWith('test-user-123');
    });
  });

  it('should call unfollowUser API when unfollow button is pressed', async () => {
    const mockResponse = { success: true, message: 'Successfully unfollowed user' };
    (mockOxyServices.unfollowUser as jest.Mock).mockResolvedValue(mockResponse);

    const { getByText } = render(
      <TestWrapper>
        <FollowButton userId="test-user-123" initiallyFollowing={true} />
      </TestWrapper>
    );

    const unfollowButton = getByText('Following');
    fireEvent.press(unfollowButton);

    await waitFor(() => {
      expect(mockOxyServices.unfollowUser).toHaveBeenCalledWith('test-user-123');
    });
  });

  it('should handle API errors gracefully', async () => {
    const mockError = new Error('Network error');
    (mockOxyServices.followUser as jest.Mock).mockRejectedValue(mockError);

    const { getByText } = render(
      <TestWrapper>
        <FollowButton userId="test-user-123" initiallyFollowing={false} />
      </TestWrapper>
    );

    const followButton = getByText('Follow');
    fireEvent.press(followButton);

    await waitFor(() => {
      expect(mockOxyServices.followUser).toHaveBeenCalledWith('test-user-123');
    });

    // The button text should remain "Follow" if the API call failed
    expect(getByText('Follow')).toBeTruthy();
  });
});