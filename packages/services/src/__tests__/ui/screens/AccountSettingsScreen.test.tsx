import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AccountSettingsScreen from '../../../ui/screens/AccountSettingsScreen';
import { OxyContextProvider } from '../../../ui/context/OxyContext';
import { OxyServices } from '../../../core';

// Mock the OxyContext
jest.mock('../../../ui/context/OxyContext', () => ({
  useOxy: jest.fn(() => ({
    user: {
      id: '123',
      username: 'testuser',
      email: 'test@example.com',
      bio: 'Test bio',
      avatar: { url: 'https://example.com/avatar.jpg' }
    },
    oxyServices: {
      updateProfile: jest.fn(() => Promise.resolve({
        id: '123',
        username: 'testuser',
        email: 'test@example.com'
      }))
    },
    isLoading: false
  })),
  OxyContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

// Mock the Avatar component
jest.mock('../../../ui/components/Avatar', () => 'Avatar');

describe('AccountSettingsScreen', () => {
  const mockOxyServices = {
    updateProfile: jest.fn(() => Promise.resolve({
      id: '123',
      username: 'testuser',
      email: 'test@example.com'
    }))
  } as unknown as OxyServices;

  const defaultProps = {
    goBack: jest.fn(),
    theme: 'light' as const,
    navigate: jest.fn(),
    oxyServices: mockOxyServices,
  };

  it('renders correctly with default props', () => {
    const { getByText, getByTestId } = render(
      <AccountSettingsScreen {...defaultProps} />
    );
    
    // Check if the screen title is rendered
    expect(getByText('Account Settings')).toBeTruthy();
    
    // Check if profile form is rendered by default
    expect(getByTestId('username-input')).toBeTruthy();
    expect(getByTestId('email-input')).toBeTruthy();
    expect(getByTestId('bio-input')).toBeTruthy();
  });

  it('switches between tabs correctly', async () => {
    const { getByText, queryByTestId } = render(
      <AccountSettingsScreen {...defaultProps} />
    );
    
    // Initially on profile tab
    expect(queryByTestId('username-input')).toBeTruthy();
    
    // Switch to password tab
    fireEvent.press(getByText('Password'));
    expect(queryByTestId('current-password-input')).toBeTruthy();
    expect(queryByTestId('username-input')).toBeFalsy();
    
    // Switch to notifications tab
    fireEvent.press(getByText('Notifications'));
    expect(queryByTestId('email-notifications-switch')).toBeTruthy();
    expect(queryByTestId('current-password-input')).toBeFalsy();
    
    // Switch back to profile tab
    fireEvent.press(getByText('Profile'));
    expect(queryByTestId('username-input')).toBeTruthy();
    expect(queryByTestId('email-notifications-switch')).toBeFalsy();
  });

  it('validates profile form inputs', async () => {
    const { getByText, getByTestId } = render(
      <AccountSettingsScreen {...defaultProps} />
    );
    
    // Clear username (which is required)
    fireEvent.changeText(getByTestId('username-input'), '');
    
    // Try to save with empty username
    fireEvent.press(getByTestId('save-profile-button'));
    
    // Should display error message
    await waitFor(() => {
      expect(getByText('Username is required')).toBeTruthy();
    });
  });

  it('opens with the specified activeTab', () => {
    const { queryByTestId } = render(
      <AccountSettingsScreen {...defaultProps} activeTab="password" />
    );
    
    // Should be on password tab
    expect(queryByTestId('current-password-input')).toBeTruthy();
    expect(queryByTestId('username-input')).toBeFalsy();
  });
});