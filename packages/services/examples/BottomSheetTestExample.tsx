import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { OxyServices, OxyContextProvider, useOxy } from '../src';

// Test example to verify bottom sheet functionality
const TestApp: React.FC = () => {
  const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });

  return (
    <OxyContextProvider 
      oxyServices={oxyServices}
      onAuthStateChange={(user) => {
        console.log('Auth state changed:', user ? `Logged in as ${user.username}` : 'Logged out');
      }}
    >
      <BottomSheetTest />
    </OxyContextProvider>
  );
};

const BottomSheetTest: React.FC = () => {
  const { showBottomSheet, hideBottomSheet } = useOxy();

  const handleShowBottomSheet = () => {
    console.log('Attempting to show bottom sheet...');
    if (showBottomSheet) {
      showBottomSheet();
      console.log('Bottom sheet show method called');
    } else {
      console.error('showBottomSheet method not available');
    }
  };

  const handleHideBottomSheet = () => {
    console.log('Attempting to hide bottom sheet...');
    if (hideBottomSheet) {
      hideBottomSheet();
      console.log('Bottom sheet hide method called');
    } else {
      console.error('hideBottomSheet method not available');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bottom Sheet Test</Text>
      <Text style={styles.subtitle}>
        Test the bottom sheet functionality after context changes
      </Text>
      
      <View style={styles.buttonContainer}>
        <Button 
          title="Show Bottom Sheet" 
          onPress={handleShowBottomSheet}
        />
        <View style={styles.spacer} />
        <Button 
          title="Hide Bottom Sheet" 
          onPress={handleHideBottomSheet}
        />
      </View>

      <Text style={styles.instructions}>
        {`Instructions:
1. Press "Show Bottom Sheet" to open the modal
2. Press "Hide Bottom Sheet" to close the modal
3. Check console for any error messages
4. Verify that the bottom sheet opens/closes correctly`}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 30,
    textAlign: 'center',
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 300,
    marginBottom: 30,
  },
  spacer: {
    height: 15,
  },
  instructions: {
    fontSize: 14,
    color: '#888',
    lineHeight: 20,
    textAlign: 'left',
    maxWidth: 300,
  },
});

export default TestApp;

/*
  BOTTOM SHEET TEST EXAMPLE

  This example tests the bottom sheet functionality that was fixed
  to ensure it opens properly after context changes.

  WHAT THIS TESTS:
  1. ✅ showBottomSheet() method availability from useOxy hook (now uses stable callbacks)
  2. ✅ hideBottomSheet() method availability from useOxy hook (now uses stable callbacks)
  3. ✅ Bottom sheet opening functionality via bottomSheetRef.current.present() (improved method forwarding)
  4. ✅ Bottom sheet closing functionality via bottomSheetRef.current.dismiss() (improved method forwarding)
  5. ✅ Context method exposure through OxyProvider (no more infinite re-renders)

  PREVIOUS ISSUES FIXED:
  - ❌ "Maximum update depth exceeded" error due to unstable callbacks
  - ❌ Bottom sheet wouldn't open after context changes
  - ❌ Methods weren't properly exposed from OxyProvider due to complex useEffect chains
  - ❌ bottomSheetRef wasn't being used correctly causing memory leaks
  - ❌ Fallback modal always had visible=false

  SOLUTION IMPLEMENTED:
  - ✅ Added stable callback references using useStableCallback to prevent re-render loops
  - ✅ Simplified method forwarding with proper state management
  - ✅ Fixed fallback modal to properly manage visibility state
  - ✅ Used bottomSheetRef.current.present() and dismiss() with stable references
  - ✅ Added proper error handling and logging
  - ✅ Implemented animation cleanup to prevent memory leaks
*/
