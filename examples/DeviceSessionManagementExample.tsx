import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { 
  OxyProvider, 
  useOxy, 
  SessionManagementScreen,
  AccountCenterScreen 
} from '@oxyhq/services';

// Initialize OxyServices with your configuration
import { OxyServices, DeviceManager } from '@oxyhq/services';

const oxyServices = new OxyServices({
  apiUrl: 'https://your-api-endpoint.com',
  publicKey: 'your-public-key'
});

// Device Session Management Hook
const useDeviceSessionManagement = () => {
  const { user, sessions, isAuthenticated, oxyServices } = useOxy();
  const [deviceSessions, setDeviceSessions] = useState([]);
  const [deviceInfo, setDeviceInfo] = useState(null);

  useEffect(() => {
    initializeDeviceManager();
  }, []);

  const initializeDeviceManager = async () => {
    try {
      // Initialize device manager for fingerprinting
      const deviceManager = new DeviceManager();
      await deviceManager.initialize();
      
      const fingerprint = await deviceManager.generateFingerprint();
      const deviceId = await deviceManager.getDeviceId();
      
      setDeviceInfo({
        deviceId,
        fingerprint,
        platform: deviceManager.platform,
        userAgent: deviceManager.userAgent
      });
    } catch (error) {
      console.error('Failed to initialize device manager:', error);
    }
  };

  const loadDeviceSessions = async () => {
    if (!isAuthenticated || !oxyServices) return;

    try {
      const sessions = await oxyServices.getDeviceSessions();
      setDeviceSessions(sessions);
    } catch (error) {
      console.error('Failed to load device sessions:', error);
    }
  };

  const logoutAllDeviceSessions = async () => {
    if (!isAuthenticated || !oxyServices) return;

    try {
      await oxyServices.logoutAllDeviceSessions();
      Alert.alert('Success', 'All device sessions have been logged out');
      loadDeviceSessions();
    } catch (error) {
      Alert.alert('Error', 'Failed to logout all sessions');
    }
  };

  const updateDeviceName = async (newName: string) => {
    if (!isAuthenticated || !oxyServices) return;

    try {
      await oxyServices.updateDeviceName(newName);
      Alert.alert('Success', 'Device name updated successfully');
      loadDeviceSessions();
    } catch (error) {
      Alert.alert('Error', 'Failed to update device name');
    }
  };

  return {
    deviceSessions,
    deviceInfo,
    loadDeviceSessions,
    logoutAllDeviceSessions,
    updateDeviceName
  };
};

// Device Session Manager Component
const DeviceSessionManager: React.FC = () => {
  const { 
    deviceSessions, 
    deviceInfo, 
    loadDeviceSessions, 
    logoutAllDeviceSessions,
    updateDeviceName 
  } = useDeviceSessionManagement();

  const { user, isAuthenticated } = useOxy();

  useEffect(() => {
    if (isAuthenticated) {
      loadDeviceSessions();
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Device Session Management</Text>
        <Text style={styles.subtitle}>Please sign in to manage device sessions</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Device Session Management</Text>
      
      {/* Current Device Information */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current Device</Text>
        {deviceInfo && (
          <View style={styles.deviceCard}>
            <Text style={styles.deviceText}>Device ID: {deviceInfo.deviceId}</Text>
            <Text style={styles.deviceText}>Platform: {deviceInfo.platform}</Text>
            <Text style={styles.deviceText}>Fingerprint: {deviceInfo.fingerprint.slice(0, 16)}...</Text>
          </View>
        )}
      </View>

      {/* Active User Information */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current User</Text>
        <View style={styles.userCard}>
          <Text style={styles.userText}>Username: {user?.username}</Text>
          <Text style={styles.userText}>Email: {user?.email}</Text>
        </View>
      </View>

      {/* Device Sessions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Device Sessions ({deviceSessions.length})</Text>
        {deviceSessions.map((session, index) => (
          <View key={session.id || index} style={styles.sessionCard}>
            <Text style={styles.sessionText}>Session: {session.id}</Text>
            <Text style={styles.sessionText}>Last Activity: {session.lastActivity}</Text>
            <Text style={styles.sessionText}>Current: {session.isCurrent ? 'Yes' : 'No'}</Text>
          </View>
        ))}
      </View>

      {/* Device Management Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Device Management</Text>
        
        <TouchableOpacity 
          style={styles.button} 
          onPress={loadDeviceSessions}
        >
          <Text style={styles.buttonText}>Refresh Sessions</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.button, styles.dangerButton]} 
          onPress={logoutAllDeviceSessions}
        >
          <Text style={styles.buttonText}>Logout All Device Sessions</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.button} 
          onPress={() => updateDeviceName('My Updated Device')}
        >
          <Text style={styles.buttonText}>Update Device Name</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

// Main Example App
const DeviceSessionManagementExample: React.FC = () => {
  const [showSessionManager, setShowSessionManager] = useState(false);
  const [showAccountCenter, setShowAccountCenter] = useState(false);

  return (
    <OxyProvider
      oxyServices={oxyServices}
      theme="light"
      onAuthenticated={(user) => {
        console.log('User authenticated with device session:', user);
      }}
      onAuthStateChange={(user) => {
        console.log('Auth state changed:', user ? 'Logged in' : 'Logged out');
      }}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Enhanced Device Session Management</Text>
        <Text style={styles.subtitle}>
          Multi-user authentication with device-based session isolation
        </Text>

        {/* Navigation Buttons */}
        <TouchableOpacity 
          style={styles.button}
          onPress={() => setShowSessionManager(true)}
        >
          <Text style={styles.buttonText}>Open Session Manager</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.button}
          onPress={() => setShowAccountCenter(true)}
        >
          <Text style={styles.buttonText}>Open Account Center</Text>
        </TouchableOpacity>

        {/* Device Session Manager */}
        <DeviceSessionManager />

        {/* Session Management Screen Modal */}
        {showSessionManager && (
          <SessionManagementScreen
            onClose={() => setShowSessionManager(false)}
            theme="light"
          />
        )}

        {/* Account Center Screen Modal */}
        {showAccountCenter && (
          <AccountCenterScreen
            onClose={() => setShowAccountCenter(false)}
            theme="light"
          />
        )}
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
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  deviceCard: {
    backgroundColor: '#f5f5f5',
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  userCard: {
    backgroundColor: '#e3f2fd',
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2196f3',
  },
  sessionCard: {
    backgroundColor: '#fff3e0',
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ff9800',
    marginBottom: 10,
  },
  deviceText: {
    fontSize: 14,
    marginBottom: 5,
  },
  userText: {
    fontSize: 14,
    marginBottom: 5,
    color: '#1976d2',
  },
  sessionText: {
    fontSize: 14,
    marginBottom: 5,
    color: '#f57c00',
  },
  button: {
    backgroundColor: '#2196f3',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  dangerButton: {
    backgroundColor: '#f44336',
  },
  buttonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default DeviceSessionManagementExample;
