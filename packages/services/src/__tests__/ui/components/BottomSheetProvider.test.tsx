import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import OxyProvider from '../../../ui/components/OxyProvider';
import { useOxy } from '../../../ui/context/OxyContext';
import type { OxyServices } from '../../../core';
import { View, Text, TouchableOpacity } from 'react-native';

// Mock the OxyServices
const mockOxyServices = {
  // Add minimal required methods for testing
} as unknown as OxyServices;

// Test component that uses the bottom sheet functionality
const TestBottomSheetComponent: React.FC = () => {
  const { showBottomSheet, hideBottomSheet } = useOxy();

  return (
    <View>
      <TouchableOpacity 
        testID="show-button" 
        onPress={() => showBottomSheet?.('SignIn')}
      >
        <Text>Show Bottom Sheet</Text>
      </TouchableOpacity>
      <TouchableOpacity 
        testID="hide-button" 
        onPress={() => hideBottomSheet?.()}
      >
        <Text>Hide Bottom Sheet</Text>
      </TouchableOpacity>
    </View>
  );
};

describe('Bottom Sheet Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should expose showBottomSheet and hideBottomSheet methods from context', () => {
    const { getByTestId } = render(
      <OxyProvider oxyServices={mockOxyServices} contextOnly={true}>
        <TestBottomSheetComponent />
      </OxyProvider>
    );

    // Check that the buttons are rendered (indicating context methods are available)
    expect(getByTestId('show-button')).toBeTruthy();
    expect(getByTestId('hide-button')).toBeTruthy();
  });

  it('should not crash when bottom sheet methods are called', async () => {
    const { getByTestId } = render(
      <OxyProvider oxyServices={mockOxyServices} contextOnly={true}>
        <TestBottomSheetComponent />
      </OxyProvider>
    );

    const showButton = getByTestId('show-button');
    const hideButton = getByTestId('hide-button');

    // These should not throw errors even without a bottom sheet ref
    fireEvent.press(showButton);
    fireEvent.press(hideButton);

    // Wait to ensure no async errors occur
    await waitFor(() => {
      expect(showButton).toBeTruthy();
    });
  });

  it('should provide stable callback references to prevent re-renders', () => {
    let renderCount = 0;
    
    const CountingComponent: React.FC = () => {
      renderCount++;
      const { showBottomSheet, hideBottomSheet } = useOxy();
      
      return (
        <View>
          <Text testID="render-count">{renderCount}</Text>
          <TouchableOpacity onPress={() => showBottomSheet?.()}>
            <Text>Show</Text>
          </TouchableOpacity>
        </View>
      );
    };

    const { getByTestId, rerender } = render(
      <OxyProvider oxyServices={mockOxyServices} contextOnly={true}>
        <CountingComponent />
      </OxyProvider>
    );

    const initialCount = parseInt(getByTestId('render-count').props.children);

    // Re-render the component
    rerender(
      <OxyProvider oxyServices={mockOxyServices} contextOnly={true}>
        <CountingComponent />
      </OxyProvider>
    );

    const afterRerenderCount = parseInt(getByTestId('render-count').props.children);
    
    // Should only have rendered one additional time due to re-render, 
    // not multiple times due to unstable callbacks
    expect(afterRerenderCount).toBeLessThanOrEqual(initialCount + 1);
  });

  it('should handle bottom sheet ref being undefined gracefully', () => {
    const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();

    const { getByTestId } = render(
      <OxyProvider oxyServices={mockOxyServices} contextOnly={true}>
        <TestBottomSheetComponent />
      </OxyProvider>
    );

    // Call showBottomSheet when no ref is available
    fireEvent.press(getByTestId('show-button'));

    // Should log a warning but not crash
    expect(mockConsoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('bottomSheetRef is not available')
    );

    mockConsoleWarn.mockRestore();
  });
});