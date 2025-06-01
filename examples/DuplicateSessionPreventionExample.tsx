import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useOxy } from '../src/ui/context/OxyContext';

/**
 * Example component demonstrating duplicate session prevention
 * 
 * This example shows how the enhanced session management prevents
 * the same user from having multiple sessions on the same device.
 */
export default function DuplicateSessionPreventionExample() {
  const { 
    user, 
    sessions, 
    isLoading, 
    isAuthenticated, 
    login, 
    logout,
    logoutAll 
  } = useOxy();

  const [loginCredentials, setLoginCredentials] = useState({
    username: 'testuser1',
    password: 'password123'
  });

  const handleTestLogin = async () => {
    try {
      console.log('=== Testing Duplicate Session Prevention ===');
      console.log('Current sessions before login:', sessions.length);
      
      await login(loginCredentials.username, loginCredentials.password);
      
      Alert.alert(
        'Login Successful',
        `Welcome ${user?.username}! Check the console for session management details.`
      );
    } catch (error: any) {
      Alert.alert('Login Failed', error.message);
    }
  };

  const handleMultipleLogins = async () => {
    try {
      console.log('=== Testing Multiple Login Attempts ===');
      console.log('Current sessions before multiple attempts:', sessions.length);
      
      // Attempt multiple logins for the same user
      for (let i = 1; i <= 3; i++) {
        console.log(`Login attempt ${i} for user ${loginCredentials.username}`);
        await login(loginCredentials.username, loginCredentials.password, `Device Name ${i}`);
        console.log(`Sessions after attempt ${i}:`, sessions.length);
      }
      
      Alert.alert(
        'Multiple Login Test Complete',
        `Despite 3 login attempts, you should only have 1 session for ${loginCredentials.username}. Check console for details.`
      );
    } catch (error: any) {
      Alert.alert('Test Failed', error.message);
    }
  };

  const handleDifferentUserLogin = async () => {
    try {
      console.log('=== Testing Different User Login ===');
      console.log('Current sessions before different user login:', sessions.length);
      
      // Login with a different user
      await login('testuser2', 'password123', 'Test Device');
      
      Alert.alert(
        'Different User Login',
        `Now logged in as different user. Total sessions: ${sessions.length}`
      );
    } catch (error: any) {
      Alert.alert('Login Failed', error.message);
    }
  };

  const renderSessionInfo = () => {
    if (sessions.length === 0) {
      return <Text style={styles.infoText}>No active sessions</Text>;
    }

    return sessions.map((session, index) => (
      <View key={session.sessionId} style={styles.sessionCard}>
        <Text style={styles.sessionTitle}>Session {index + 1}</Text>
        <Text style={styles.sessionDetail}>User: {session.username || 'Unknown'}</Text>
        <Text style={styles.sessionDetail}>Session ID: {session.sessionId.substring(0, 8)}...</Text>
        <Text style={styles.sessionDetail}>Device ID: {session.deviceId.substring(0, 8)}...</Text>
        <Text style={styles.sessionDetail}>
          Active: {session.sessionId === user?.sessionId ? 'Yes' : 'No'}
        </Text>
      </View>
    ));
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Duplicate Session Prevention Test</Text>
      
      <Text style={styles.description}>
        This example demonstrates how the system prevents duplicate sessions 
        for the same user account on the same device.
      </Text>

      {/* Authentication Status */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current Status</Text>
        <Text style={styles.statusText}>
          Authenticated: {isAuthenticated ? 'Yes' : 'No'}
        </Text>
        <Text style={styles.statusText}>
          Current User: {user?.username || 'None'}
        </Text>
        <Text style={styles.statusText}>
          Total Sessions: {sessions.length}
        </Text>
      </View>

      {/* Session Information */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Active Sessions</Text>
        {renderSessionInfo()}
      </View>

      {/* Test Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Test Actions</Text>
        
        <TouchableOpacity 
          style={styles.button} 
          onPress={handleTestLogin}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>
            Login as {loginCredentials.username}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.button} 
          onPress={handleMultipleLogins}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>
            Test Multiple Logins (Same User)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.button} 
          onPress={handleDifferentUserLogin}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>
            Login as Different User
          </Text>
        </TouchableOpacity>

        {isAuthenticated && (
          <>
            <TouchableOpacity 
              style={[styles.button, styles.logoutButton]} 
              onPress={() => logout()}
              disabled={isLoading}
            >
              <Text style={styles.buttonText}>Logout Current</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.button, styles.logoutButton]} 
              onPress={() => logoutAll()}
              disabled={isLoading}
            >
              <Text style={styles.buttonText}>Logout All</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Expected Behavior */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Expected Behavior</Text>
        <Text style={styles.infoText}>
          • Multiple login attempts for the same user should reuse/update the existing session
        </Text>
        <Text style={styles.infoText}>
          • The session count should not increase when logging in with the same account
        </Text>
        <Text style={styles.infoText}>
          • Different users can have separate sessions on the same device
        </Text>
        <Text style={styles.infoText}>
          • Server-side session management prevents duplicate authentication
        </Text>
      </View>
    </ScrollView>
  );
}

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
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    color: '#666',
    fontStyle: 'italic',
  },
  section: {
    backgroundColor: 'white',
    padding: 15,
    marginBottom: 15,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  statusText: {
    fontSize: 16,
    marginBottom: 5,
    color: '#333',
  },
  infoText: {
    fontSize: 14,
    marginBottom: 8,
    color: '#666',
    lineHeight: 20,
  },
  sessionCard: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    marginBottom: 10,
    borderRadius: 6,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  sessionDetail: {
    fontSize: 14,
    marginBottom: 3,
    color: '#666',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
  },
  logoutButton: {
    backgroundColor: '#FF3B30',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
