import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView
} from 'react-native';
import { OxyProvider, OxyServices, useOxy } from '@oxyhq/services/full';

// Initialize OxyServices  
const oxyServices = new OxyServices({
  baseURL: 'http://localhost:3001',
});

function DebugInterface() {
  const { 
    user, 
    sessions, 
    activeSessionId,
    logoutAll,
    isLoading 
  } = useOxy();

  const [debugInfo, setDebugInfo] = useState('');

  const showDebugInfo = () => {
    const info = `
Debug Info:
- User: ${user ? (user as any).username : 'null'}
- Active Session ID: ${activeSessionId || 'null'}  
- Sessions Count: ${Array.isArray(sessions) ? sessions.length : 0}
- Is Loading: ${isLoading}
- Sessions: ${JSON.stringify(sessions, null, 2)}
    `;
    setDebugInfo(info);
    console.log('Current state:', {
      user,
      activeSessionId,
      sessions,
      isLoading
    });
  };

  const testLogoutAll = async () => {
    console.log('=== TESTING LOGOUT ALL ===');
    console.log('Before logout - activeSessionId:', activeSessionId);
    console.log('Before logout - sessions:', sessions);
    
    if (!activeSessionId) {
      Alert.alert('Error', 'No active session ID found. Please login first.');
      return;
    }

    try {
      console.log('Calling logoutAll()...');
      if (typeof logoutAll === 'function') {
        await logoutAll();
        console.log('logoutAll() completed successfully');
        Alert.alert('Success', 'Logout all completed!');
      } else {
        throw new Error('logoutAll is not a function');
      }
    } catch (error) {
      console.error('Logout all failed:', error);
      Alert.alert('Error', `Logout failed: ${(error as any)?.message || 'Unknown error'}`);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Logout All Debug Test</Text>
      
      <TouchableOpacity style={styles.button} onPress={showDebugInfo}>
        <Text style={styles.buttonText}>Show Debug Info</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.button, styles.logoutButton]} 
        onPress={testLogoutAll}
        disabled={!activeSessionId}
      >
        <Text style={styles.buttonText}>
          Test Logout All {!activeSessionId ? '(No Session)' : ''}
        </Text>
      </TouchableOpacity>

      {debugInfo ? (
        <View style={styles.debugContainer}>
          <Text style={styles.debugText}>{debugInfo}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

export default function LogoutAllDebugExample() {
  return (
    <OxyProvider
      oxyServices={oxyServices}
      storageKeyPrefix="debug_logout"
      onAuthStateChange={(user) => {
        console.log('Auth state changed:', user?.username || 'logged out');
      }}
      theme="light"
    >
      <DebugInterface />
    </OxyProvider>
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
    marginBottom: 20,
    textAlign: 'center',
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
    fontWeight: '600',
  },
  debugContainer: {
    backgroundColor: '#f0f0f0',
    padding: 15,
    borderRadius: 8,
    marginTop: 20,
  },
  debugText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#333',
  },
});
