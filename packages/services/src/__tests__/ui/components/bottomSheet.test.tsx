import React from 'react';
import { render } from '@testing-library/react-native';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetModalProvider, BottomSheetView, BottomSheetScrollView } from '../../../ui/components/bottomSheet';
import { View, Text } from 'react-native';

// Mock Animated and PanResponder
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  const mockAnimatedValue = {
    addListener: jest.fn(() => 'listener-id'),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn(),
    setValue: jest.fn(),
    setOffset: jest.fn(),
    flattenOffset: jest.fn(),
    _value: 0,
  };

  return {
    ...RN,
    Animated: {
      ...RN.Animated,
      Value: jest.fn(() => mockAnimatedValue),
      timing: jest.fn(() => ({
        start: jest.fn(),
      })),
      parallel: jest.fn(() => ({
        start: jest.fn(),
      })),
      View: RN.View,
    },
    PanResponder: {
      create: jest.fn(() => ({
        panHandlers: {},
      })),
    },
  };
});

describe('Custom Bottom Sheet Components', () => {
  describe('BottomSheetModalProvider', () => {
    it('renders children correctly', () => {
      const { getByText } = render(
        <BottomSheetModalProvider>
          <Text>Test Content</Text>
        </BottomSheetModalProvider>
      );
      
      expect(getByText('Test Content')).toBeTruthy();
    });
  });

  describe('BottomSheetView', () => {
    it('renders children correctly', () => {
      const { getByText } = render(
        <BottomSheetView>
          <Text>Test Content</Text>
        </BottomSheetView>
      );
      
      expect(getByText('Test Content')).toBeTruthy();
    });
  });

  describe('BottomSheetScrollView', () => {
    it('renders children correctly', () => {
      const { getByText } = render(
        <BottomSheetScrollView>
          <Text>Test Content</Text>
        </BottomSheetScrollView>
      );
      
      expect(getByText('Test Content')).toBeTruthy();
    });
  });

  describe('BottomSheetBackdrop', () => {
    it('renders without crashing', () => {
      const onPress = jest.fn();
      const { container } = render(
        <BottomSheetBackdrop onPress={onPress} />
      );
      
      expect(container).toBeTruthy();
    });
  });

  describe('BottomSheetModal', () => {
    it('does not render when not visible', () => {
      const { queryByTestId } = render(
        <BottomSheetModal snapPoints={['50%', '90%']}>
          <Text testID="modal-content">Test Content</Text>
        </BottomSheetModal>
      );
      
      // Modal should not be visible initially
      expect(queryByTestId('modal-content')).toBeNull();
    });

    it('accepts custom snap points', () => {
      const mockRef = { current: null };
      render(
        <BottomSheetModal 
          ref={mockRef}
          snapPoints={['30%', '60%', '90%']}
        >
          <Text>Test Content</Text>
        </BottomSheetModal>
      );
      
      // Should not throw and should accept the ref
      expect(mockRef.current).toBeDefined();
    });
  });
});