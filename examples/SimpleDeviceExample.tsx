import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { 
  OxyProvider, 
  OxyServices, 
  OxySignInButton, 
  OxyLogo, 
  Avatar,
  DeviceManager 
} from '@oxyhq/services';

/**
 * Simple Device Session Management Example
 * 
 * This example demonstrates the basic usage of the enhanced device-based
 * session management features in a simple, easy-to-understand format.
 */

// Initialize OxyServices with your configuration
const oxyServices = new OxyServices({
  apiUrl: 'https://your-api-endpoint.com',
  publicKey: 'your-public-key'
});

const SimpleDeviceExample: React.FC = () => {
  const [deviceInfo, setDeviceInfo] = useState<string>('');
  const [status, setStatus] = useState<string>('Ready');

  const handleInitializeDevice = async () => {
    try {
      setStatus('Getting device information...');
      
      // Get device fingerprint and info using static methods
      const fingerprint = DeviceManager.getDeviceFingerprint();
      const deviceInfo = await DeviceManager.getDeviceInfo();
      
      setDeviceInfo(`Device ID: ${deviceInfo.deviceId}\nPlatform: ${fingerprint.platform}\nFingerprint: ${deviceInfo.fingerprint?.slice(0, 20)}...`);
      setStatus('Device information loaded');
      
      Alert.alert('Success', 'Device information loaded successfully');
    } catch (error: any) {
      setStatus('Error loading device info');
      Alert.alert('Error', error.message || 'Failed to load device information');
    }
  };

  const handleTestLogin = async () => {
    try {
      setStatus('Testing enhanced login...');
      
      // This would typically be done with actual credentials
      // The login now includes device fingerprinting automatically
      Alert.alert(
        'Enhanced Login', 
        'This demonstrates the enhanced login flow with device fingerprinting.\n\nIn a real app, this would:\n- Generate device fingerprint\n- Send to server with credentials\n- Create device-specific session\n- Enable multi-user support'
      );
      
      setStatus('Enhanced login demo completed');
    } catch (error: any) {
      setStatus('Login test failed');
      Alert.alert('Error', error.message || 'Login test failed');
    }
  };

  return (
    <OxyProvider
      oxyServices={oxyServices}
      theme="light"
      onAuthenticated={(user) => {
        console.log('User authenticated with device session');
      }}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <OxyLogo 
            width={120} 
            height={40} 
            fillColor="#2196f3" 
            secondaryFillColor="#1976d2" 
            theme="light" 
            style={styles.logo} 
          />
          <Text style={styles.title}>Enhanced Device Sessions</Text>
          <Text style={styles.subtitle}>v5.3.0 Features Demo</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Device Management</Text>
          <Text style={styles.description}>
            The new device-based session management provides secure, 
            isolated sessions for multiple users on shared devices.
          </Text>

          <TouchableOpacity 
            style={styles.button} 
            onPress={handleInitializeDevice}
          >
            <Text style={styles.buttonText}>Initialize Device Manager</Text>
          </TouchableOpacity>

          {deviceInfo ? (
            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>Device Information:</Text>
              <Text style={styles.infoText}>{deviceInfo}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Enhanced Authentication</Text>
          <Text style={styles.description}>
            Login now includes automatic device fingerprinting for better security and session management.
          </Text>

          <TouchableOpacity 
            style={styles.button} 
            onPress={handleTestLogin}
          >
            <Text style={styles.buttonText}>Test Enhanced Login</Text>
          </TouchableOpacity>

          {/* Use the enhanced sign-in button */}
          <OxySignInButton 
            onPress={() => Alert.alert('Sign In', 'This would open the sign-in flow')}
            style={styles.oxyButton}
            textStyle={styles.buttonText}
            text="Sign In with Oxy Services"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Features</Text>
          <View style={styles.featureList}>
            <Text style={styles.featureItem}>✓ Device fingerprinting for consistent identification</Text>
            <Text style={styles.featureItem}>✓ Multi-user support on shared devices</Text>
            <Text style={styles.featureItem}>✓ Session isolation between users</Text>
            <Text style={styles.featureItem}>✓ Remote session management</Text>
            <Text style={styles.featureItem}>✓ No local PII storage</Text>
            <Text style={styles.featureItem}>✓ Cross-platform support (Web + React Native)</Text>
          </View>
        </View>

        <View style={styles.statusBar}>
          <Text style={styles.statusText}>Status: {status}</Text>
        </View>
      </View>
    </OxyProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  logo: {
    marginBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 10,
    textAlign: 'center',
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 5,
  },
  section: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 15,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#2196f3',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  buttonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: 'bold',
  },
  oxyButton: {
    marginTop: 10,
  },
  infoBox: {
    backgroundColor: '#f5f5f5',
    padding: 15,
    borderRadius: 8,
    marginTop: 10,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  infoText: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
  },
  featureList: {
    paddingLeft: 10,
  },
  featureItem: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
    lineHeight: 20,
  },
  statusBar: {
    marginTop: 20,
    padding: 10,
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    color: '#1976d2',
    textAlign: 'center',
  },
});

export default SimpleDeviceExample;
