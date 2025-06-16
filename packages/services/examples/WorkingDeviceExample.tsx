/**
 * Working Device Management Example
 * 
 * This example demonstrates how to use the DeviceManager utility
 * and device-based session management features in @oxyhq/services v5.3.0
 * 
 * Note: This example shows component usage only. Screens are handled
 * internally by the package router and are not exported for external use.
 */

import * as React from 'react';
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import {
  OxyProvider,
  useOxy,
  DeviceManager,
  OxyServices,
  type DeviceFingerprint,
  type StoredDeviceInfo
} from '@oxyhq/services';

// Initialize OxyServices with device tracking enabled
const oxyServices = new OxyServices({
  publicKey: 'your-public-key-here',
  enableDeviceTracking: true,
  maxDevicesPerUser: 5
});

// Custom hook for device management
const useDeviceManagement = () => {
  const { user, isAuthenticated } = useOxy();
  const [deviceInfo, setDeviceInfo] = useState<StoredDeviceInfo | null>(null);
  const [deviceSessions, setDeviceSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Get current device information
  const getCurrentDevice = async () => {
    try {
      const fingerprint = DeviceManager.getDeviceFingerprint();
      const storedInfo = await DeviceManager.getDeviceInfo();
      
      const currentDevice: StoredDeviceInfo = {
        deviceId: storedInfo.deviceId,
        fingerprint: JSON.stringify(fingerprint),
        deviceName: storedInfo.deviceName || DeviceManager.getDefaultDeviceName(),
        createdAt: storedInfo.createdAt,
        lastUsed: new Date().toISOString()
      };

      setDeviceInfo(currentDevice);
      return currentDevice;
    } catch (error) {
      console.error('Error getting device info:', error);
      return null;
    }
  };

  // Load device sessions for the current user
  const loadDeviceSessions = async () => {
    if (!user || !isAuthenticated) return;

    setLoading(true);
    try {
      // This would typically be an API call to your backend
      // For demonstration, we'll simulate device sessions
      const mockSessions = [
        {
          id: 'session-1',
          deviceId: deviceInfo?.deviceId,
          deviceName: deviceInfo?.deviceName,
          platform: 'Web',
          lastActivity: new Date().toISOString(),
          isCurrent: true,
          location: 'Current Device'
        },
        {
          id: 'session-2', 
          deviceId: 'device-2',
          deviceName: 'Mobile Device',
          platform: 'iOS',
          lastActivity: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          isCurrent: false,
          location: 'Previous Device'
        }
      ];

      setDeviceSessions(mockSessions);
    } catch (error) {
      console.error('Error loading device sessions:', error);
      Alert.alert('Error', 'Failed to load device sessions');
    } finally {
      setLoading(false);
    }
  };

  // Revoke a specific device session
  const revokeDeviceSession = async (sessionId: string) => {
    try {
      // This would be an API call to revoke the session
      setDeviceSessions(sessions => 
        sessions.filter(session => session.id !== sessionId)
      );
      Alert.alert('Success', 'Device session revoked successfully');
    } catch (error) {
      console.error('Error revoking session:', error);
      Alert.alert('Error', 'Failed to revoke device session');
    }
  };

  // Update device name
  const updateDeviceName = async (newName: string) => {
    try {
      await DeviceManager.updateDeviceName(newName);
      
      if (deviceInfo) {
        const updatedDevice = { ...deviceInfo, deviceName: newName };
        setDeviceInfo(updatedDevice);
        Alert.alert('Success', 'Device name updated successfully');
      }
    } catch (error) {
      console.error('Error updating device name:', error);
      Alert.alert('Error', 'Failed to update device name');
    }
  };

  return {
    deviceInfo,
    deviceSessions,
    loading,
    getCurrentDevice,
    loadDeviceSessions,
    revokeDeviceSession,
    updateDeviceName
  };
};

// Device Information Component
const DeviceInfoCard: React.FC<{ deviceInfo: StoredDeviceInfo }> = ({ deviceInfo }) => (
  <View style={styles.card}>
    <Text style={styles.cardTitle}>Current Device</Text>
    <Text style={styles.deviceText}>Name: {deviceInfo.deviceName}</Text>
    <Text style={styles.deviceText}>Device ID: {deviceInfo.deviceId.slice(0, 8)}...</Text>
    <Text style={styles.deviceText}>
      Fingerprint: {deviceInfo.fingerprint?.slice(0, 16)}...
    </Text>
    <Text style={styles.deviceText}>Last Used: {deviceInfo.lastUsed}</Text>
    <Text style={styles.deviceText}>Created: {deviceInfo.createdAt}</Text>
  </View>
);

// Device Sessions List Component
const DeviceSessionsList: React.FC<{
  sessions: any[];
  onRevokeSession: (sessionId: string) => void;
}> = ({ sessions, onRevokeSession }) => (
  <View style={styles.card}>
    <Text style={styles.cardTitle}>Active Device Sessions ({sessions.length})</Text>
    {sessions.map((session, index) => (
      <View key={session.id || index} style={styles.sessionItem}>
        <View style={styles.sessionInfo}>
          <Text style={styles.sessionText}>{session.deviceName}</Text>
          <Text style={styles.sessionSubtext}>{session.platform}</Text>
          <Text style={styles.sessionSubtext}>
            Last Activity: {new Date(session.lastActivity).toLocaleDateString()}
          </Text>
          {session.isCurrent && <Text style={styles.currentBadge}>Current Device</Text>}
        </View>
        {!session.isCurrent && (
          <TouchableOpacity
            style={styles.revokeButton}
            onPress={() => onRevokeSession(session.id)}
          >
            <Text style={styles.revokeButtonText}>Revoke</Text>
          </TouchableOpacity>
        )}
      </View>
    ))}
  </View>
);

// Main Device Management Screen Component
const DeviceManagementDemo: React.FC = () => {
  const { user, isAuthenticated } = useOxy();
  const {
    deviceInfo,
    deviceSessions,
    loading,
    getCurrentDevice,
    loadDeviceSessions,
    revokeDeviceSession,
    updateDeviceName
  } = useDeviceManagement();

  useEffect(() => {
    getCurrentDevice();
  }, []);

  useEffect(() => {
    if (isAuthenticated && user) {
      loadDeviceSessions();
    }
  }, [isAuthenticated, user]);

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Device Session Management</Text>
        <Text style={styles.subtitle}>Please sign in to manage device sessions</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Device Session Management</Text>
      
      {deviceInfo && <DeviceInfoCard deviceInfo={deviceInfo} />}

      <DeviceSessionsList 
        sessions={deviceSessions}
        onRevokeSession={revokeDeviceSession}
      />

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.button}
          onPress={loadDeviceSessions}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Loading...' : 'Refresh Sessions'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.button}
          onPress={() => updateDeviceName('My Updated Device')}
        >
          <Text style={styles.buttonText}>Update Device Name</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Root App Component
const App: React.FC = () => {
  return (
    <OxyProvider
      oxyServices={oxyServices}
      config={{
        theme: 'light',
        enableDeviceTracking: true,
        autoAuthCheck: true
      }}
    >
      <DeviceManagementDemo />
    </OxyProvider>
  );
};

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5'
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center'
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333'
  },
  deviceText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4
  },
  sessionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee'
  },
  sessionInfo: {
    flex: 1
  },
  sessionText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333'
  },
  sessionSubtext: {
    fontSize: 12,
    color: '#999',
    marginTop: 2
  },
  currentBadge: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: 'bold',
    marginTop: 4
  },
  revokeButton: {
    backgroundColor: '#FF5722',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4
  },
  revokeButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold'
  },
  buttonContainer: {
    marginTop: 20
  },
  button: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center'
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold'
  }
});

export default App;

/**
 * Usage Instructions:
 * 
 * 1. Install the package: npm install @oxyhq/services@5.3.0
 * 2. Configure your OxyServices instance with your API endpoints
 * 3. Use the DeviceManager utility to handle device fingerprinting
 * 4. Implement your own UI components using the exported hooks and utilities
 * 5. Screens are handled internally by the package router
 * 
 * Available exports in v5.3.0:
 * - DeviceManager: Device fingerprinting and management
 * - OxyProvider, useOxy: Context and hooks
 * - UI Components: OxySignInButton, OxyLogo, Avatar, FollowButton, FontLoader, OxyIcon
 * - Types: DeviceFingerprint, StoredDeviceInfo, OxyContextState, etc.
 * 
 * Note: Screens like SessionManagementScreen and AccountCenterScreen are used
 * internally by the package router and are not available as exports.
 */
