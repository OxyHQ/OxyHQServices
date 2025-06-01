import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { OxyProvider, useOxy } from '../src';
import { OxyServices } from '../src/core';

// Test component that uses the navigation functionality
const NavigationTestComponent: React.FC = () => {
  const { showBottomSheet, isAuthenticated, user } = useOxy();

  const testNavigationButtons = [
    { screen: 'SignIn', label: 'Test Sign In' },
    { screen: 'SignUp', label: 'Test Sign Up' },
    { screen: 'AccountCenter', label: 'Test Account Center' },
    { screen: 'KarmaCenter', label: 'Test Karma Center' },
    { screen: 'Profile', label: 'Test Profile' },
  ];

  const handleNavigationTest = (screen: string) => {
    console.log(`Testing navigation to: ${screen}`);
    try {
      showBottomSheet?.(screen);
    } catch (error) {
      console.error('Navigation test failed:', error);
      Alert.alert('Navigation Error', `Failed to navigate to ${screen}: ${error.message}`);
    }
  };

  const handleNavigationWithPropsTest = () => {
    console.log('Testing navigation with props');
    try {
      showBottomSheet?.({
        screen: 'Profile',
        props: {
          userId: 'test-user-123',
          title: 'Test Profile'
        }
      });
    } catch (error) {
      console.error('Navigation with props test failed:', error);
      Alert.alert('Navigation Error', `Failed to navigate with props: ${error.message}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Navigation Test</Text>
      <Text style={styles.subtitle}>
        Authentication Status: {isAuthenticated ? 'Logged In' : 'Not Logged In'}
      </Text>
      {user && (
        <Text style={styles.userInfo}>
          User: {user.username} ({user.email})
        </Text>
      )}
      
      <Text style={styles.sectionTitle}>Test Basic Navigation:</Text>
      {testNavigationButtons.map((button) => (
        <TouchableOpacity
          key={button.screen}
          style={styles.testButton}
          onPress={() => handleNavigationTest(button.screen)}
        >
          <Text style={styles.buttonText}>{button.label}</Text>
        </TouchableOpacity>
      ))}
      
      <Text style={styles.sectionTitle}>Test Navigation with Props:</Text>
      <TouchableOpacity
        style={[styles.testButton, styles.propsButton]}
        onPress={handleNavigationWithPropsTest}
      >
        <Text style={styles.buttonText}>Test Profile with Props</Text>
      </TouchableOpacity>
    </View>
  );
};

// Main example component
const NavigationTestExample: React.FC = () => {
  // Initialize OxyServices (replace with your actual configuration)
  const oxyServices = new OxyServices({
    baseURL: 'http://localhost:3001', // Replace with your API URL
  });

  return (
    <OxyProvider
      oxyServices={oxyServices}
      theme="light"
      initialScreen="SignIn"
    >
      <NavigationTestComponent />
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
    marginBottom: 5,
    color: '#666',
  },
  userInfo: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    color: '#888',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 10,
    color: '#333',
  },
  testButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    marginVertical: 5,
    alignItems: 'center',
  },
  propsButton: {
    backgroundColor: '#34C759',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default NavigationTestExample;
