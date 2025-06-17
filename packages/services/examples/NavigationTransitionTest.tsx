import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { OxyProvider, useOxy } from '../src';
import { OxyServices } from '../src/core';

/**
 * Test component to verify the navigation transition fixes
 * Tests rapid navigation, screen transitions, and back navigation
 */
const NavigationTransitionTest: React.FC = () => {
  const { showBottomSheet, hideBottomSheet, isAuthenticated, user } = useOxy();

  const testScreens = [
    'SignIn',
    'SignUp', 
    'AccountCenter',
    'KarmaCenter',
    'Profile',
    'AppInfo'
  ];

  const handleRapidNavigation = () => {
    console.log('Testing rapid navigation...');
    // Test rapid navigation calls (should be debounced)
    testScreens.forEach((screen, index) => {
      setTimeout(() => {
        showBottomSheet?.(screen);
      }, index * 50); // 50ms intervals to test debouncing
    });
  };

  const handleSequentialNavigation = () => {
    console.log('Testing sequential navigation...');
    // Test sequential navigation with proper delays
    testScreens.forEach((screen, index) => {
      setTimeout(() => {
        showBottomSheet?.(screen);
      }, index * 300); // 300ms intervals for smooth transitions
    });
  };

  const handleNavigationWithProps = () => {
    console.log('Testing navigation with props...');
    showBottomSheet?.({
      screen: 'Profile',
      props: {
        userId: 'test-user-123',
        title: 'Test Profile'
      }
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Navigation Transition Test</Text>
      <Text style={styles.subtitle}>
        Test the improved bottom sheet navigation transitions
      </Text>
      
      {user && (
        <Text style={styles.userInfo}>
          User: {user.username} ({user.email})
        </Text>
      )}

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.testButton} onPress={handleRapidNavigation}>
          <Text style={styles.buttonText}>Test Rapid Navigation (Debounced)</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.testButton} onPress={handleSequentialNavigation}>
          <Text style={styles.buttonText}>Test Sequential Navigation</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.testButton} onPress={handleNavigationWithProps}>
          <Text style={styles.buttonText}>Test Navigation with Props</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.testButton, styles.hideButton]} onPress={() => hideBottomSheet?.()}>
          <Text style={styles.buttonText}>Hide Bottom Sheet</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.instructions}>
        {`Test Instructions:
1. Test Rapid Navigation - Should smoothly handle multiple quick calls
2. Test Sequential Navigation - Should transition smoothly between screens
3. Test Navigation with Props - Should pass data correctly
4. During any navigation, try pressing buttons rapidly
5. Watch for smooth animations without glitches

Expected Behavior:
✅ No jarring or interrupted transitions
✅ Smooth animations between different screen types
✅ Proper debouncing of rapid navigation calls
✅ Coordinated snap point changes
✅ No race conditions or timing conflicts`}
      </Text>
    </View>
  );
};

const NavigationTransitionTestApp: React.FC = () => {
  const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });

  return (
    <OxyProvider oxyServices={oxyServices} autoPresent={false}>
      <NavigationTransitionTest />
    </OxyProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
    color: '#666',
  },
  userInfo: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    color: '#888',
  },
  buttonContainer: {
    marginBottom: 20,
  },
  testButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    marginVertical: 5,
    alignItems: 'center',
  },
  hideButton: {
    backgroundColor: '#FF3B30',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  instructions: {
    fontSize: 12,
    color: '#666',
    lineHeight: 18,
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
});

export default NavigationTransitionTestApp;
