import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator
} from 'react-native';
import { OxyProvider, OxyServices, useOxy, Avatar } from '@oxyhq/services/full';

/**
 * Complete Multi-User Authentication Example
 * 
 * This example demonstrates how to implement multi-user authentication
 * in a React Native application using the Oxy Services library.
 * 
 * Features demonstrated:
 * - Multiple account sign-in
 * - Account switching
 * - Session management
 * - Account removal
 * - Session viewing and remote logout
 */

// Initialize OxyServices
const oxyServices = new OxyServices({
  baseURL: 'http://localhost:3001', // Replace with your API URL
});

// Main App Component with OxyProvider
export default function MultiUserExample() {
  return (
    <OxyProvider
      oxyServices={oxyServices}
      storageKeyPrefix="multiuser_example" // Unique prefix for storage
      onAuthStateChange={(user) => {
        console.log('Auth state changed:', user?.username || 'logged out');
      }}
      onAuthenticated={(user) => {
        console.log('User authenticated:', user.username);
      }}
      theme="light"
    >
      <MultiUserInterface />
    </OxyProvider>
  );
}

// Main interface component
function MultiUserInterface() {
  const {
    user,
    users,
    isLoading,
    isAuthenticated,
    switchUser,
    removeUser,
    getUserSessions,
    logoutSession,
    logoutAll,
    showBottomSheet
  } = useOxy();

  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Load sessions when user changes
  useEffect(() => {
    if (user) {
      loadUserSessions();
    }
  }, [user]);

  const loadUserSessions = async () => {
    try {
      setLoadingSessions(true);
      const userSessions = await getUserSessions();
      setSessions(userSessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
      Alert.alert('Error', 'Failed to load sessions');
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleSwitchUser = async (userId) => {
    try {
      await switchUser(userId);
      Alert.alert('Success', 'Switched user successfully');
    } catch (error) {
      console.error('Failed to switch user:', error);
      Alert.alert('Error', 'Failed to switch user');
    }
  };

  const handleRemoveUser = async (userId) => {
    Alert.alert(
      'Remove Account',
      'Are you sure you want to remove this account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeUser(userId);
              Alert.alert('Success', 'Account removed successfully');
            } catch (error) {
              console.error('Failed to remove user:', error);
              Alert.alert('Error', 'Failed to remove account');
            }
          }
        }
      ]
    );
  };

  const handleLogoutSession = async (sessionId) => {
    Alert.alert(
      'Logout Session',
      'Are you sure you want to logout from this session?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await logoutSession(sessionId);
              await loadUserSessions(); // Reload sessions
              Alert.alert('Success', 'Session logged out successfully');
            } catch (error) {
              console.error('Failed to logout session:', error);
              Alert.alert('Error', 'Failed to logout session');
            }
          }
        }
      ]
    );
  };

  const handleLogoutAll = async () => {
    Alert.alert(
      'Logout All Accounts',
      'Are you sure you want to logout from all accounts?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout All',
          style: 'destructive',
          onPress: async () => {
            try {
              await logoutAll();
              Alert.alert('Success', 'Logged out from all accounts');
            } catch (error) {
              console.error('Failed to logout all:', error);
              Alert.alert('Error', 'Failed to logout from all accounts');
            }
          }
        }
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#d169e5" />
        <Text style={styles.loadingText}>Loading authentication...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Multi-User Authentication</Text>
        <Text style={styles.subtitle}>
          {isAuthenticated ? `Welcome, ${user?.username}!` : 'Please sign in'}
        </Text>
      </View>

      {/* Authentication Status */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Authentication Status</Text>
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            Status: {isAuthenticated ? 'Authenticated' : 'Not Authenticated'}
          </Text>
          <Text style={styles.statusText}>
            Total Accounts: {users.length}
          </Text>
          <Text style={styles.statusText}>
            Active Sessions: {sessions.length}
          </Text>
        </View>
      </View>

      {/* Current User Info */}
      {user && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current User</Text>
          <View style={styles.userContainer}>
            <Avatar user={user} size={50} />
            <View style={styles.userInfo}>
              <Text style={styles.username}>{user.username}</Text>
              <Text style={styles.userDetail}>ID: {user.id}</Text>
              {user.email && <Text style={styles.userDetail}>Email: {user.email}</Text>}
            </View>
          </View>
        </View>
      )}

      {/* Account Management */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account Management</Text>
        <View style={styles.buttonGrid}>
          <TouchableOpacity
            style={styles.button}
            onPress={() => showBottomSheet('SignIn')}
          >
            <Text style={styles.buttonText}>
              {user ? 'Add Another Account' : 'Sign In'}
            </Text>
          </TouchableOpacity>

          {users.length > 1 && (
            <TouchableOpacity
              style={styles.button}
              onPress={() => showBottomSheet('AccountSwitcher')}
            >
              <Text style={styles.buttonText}>Switch Account</Text>
            </TouchableOpacity>
          )}

          {user && (
            <TouchableOpacity
              style={styles.button}
              onPress={() => showBottomSheet('SessionManagement')}
            >
              <Text style={styles.buttonText}>Manage Sessions</Text>
            </TouchableOpacity>
          )}

          {user && (
            <TouchableOpacity
              style={styles.button}
              onPress={() => showBottomSheet('AccountCenter')}
            >
              <Text style={styles.buttonText}>Account Center</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* All Accounts List */}
      {users.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>All Accounts ({users.length})</Text>
          {users.map((account) => (
            <View key={account.id} style={styles.accountItem}>
              <Avatar user={account} size={40} />
              <View style={styles.accountInfo}>
                <Text style={styles.accountUsername}>{account.username}</Text>
                <Text style={styles.accountDetail}>
                  {account.id === user?.id ? 'Current' : 'Inactive'}
                </Text>
              </View>
              <View style={styles.accountActions}>
                {account.id !== user?.id && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleSwitchUser(account.id)}
                  >
                    <Text style={styles.actionButtonText}>Switch</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.actionButton, styles.removeButton]}
                  onPress={() => handleRemoveUser(account.id)}
                >
                  <Text style={styles.actionButtonText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Sessions List */}
      {user && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Active Sessions ({sessions.length})
          </Text>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={loadUserSessions}
            disabled={loadingSessions}
          >
            <Text style={styles.refreshButtonText}>
              {loadingSessions ? 'Loading...' : 'Refresh Sessions'}
            </Text>
          </TouchableOpacity>
          
          {sessions.map((session) => (
            <View key={session.id} style={styles.sessionItem}>
              <View style={styles.sessionInfo}>
                <Text style={styles.sessionPlatform}>
                  {session.deviceInfo.platform} - {session.deviceInfo.browser}
                </Text>
                <Text style={styles.sessionDetail}>
                  IP: {session.deviceInfo.ipAddress}
                </Text>
                <Text style={styles.sessionDetail}>
                  Last Active: {new Date(session.deviceInfo.lastActive).toLocaleString()}
                </Text>
                <Text style={styles.sessionDetail}>
                  Created: {new Date(session.createdAt).toLocaleString()}
                </Text>
              </View>
              {!session.isCurrent && (
                <TouchableOpacity
                  style={[styles.actionButton, styles.logoutButton]}
                  onPress={() => handleLogoutSession(session.id)}
                >
                  <Text style={styles.actionButtonText}>Logout</Text>
                </TouchableOpacity>
              )}
              {session.isCurrent && (
                <View style={styles.currentSessionBadge}>
                  <Text style={styles.currentSessionText}>Current</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Danger Zone */}
      {users.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Danger Zone</Text>
          <TouchableOpacity
            style={[styles.button, styles.dangerButton]}
            onPress={handleLogoutAll}
          >
            <Text style={[styles.buttonText, styles.dangerButtonText]}>
              Logout All Accounts
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  header: {
    backgroundColor: '#d169e5',
    padding: 20,
    paddingTop: 50,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: 'white',
    textAlign: 'center',
    marginTop: 5,
  },
  section: {
    backgroundColor: 'white',
    margin: 10,
    padding: 15,
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
  statusContainer: {
    backgroundColor: '#f9f9f9',
    padding: 10,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  userContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userInfo: {
    marginLeft: 15,
    flex: 1,
  },
  username: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  userDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  button: {
    backgroundColor: '#d169e5',
    padding: 12,
    borderRadius: 6,
    flex: 1,
    minWidth: '45%',
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  dangerButton: {
    backgroundColor: '#dc3545',
  },
  dangerButtonText: {
    color: 'white',
  },
  accountItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  accountInfo: {
    marginLeft: 10,
    flex: 1,
  },
  accountUsername: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  accountDetail: {
    fontSize: 12,
    color: '#666',
  },
  accountActions: {
    flexDirection: 'row',
    gap: 5,
  },
  actionButton: {
    backgroundColor: '#007bff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  removeButton: {
    backgroundColor: '#dc3545',
  },
  logoutButton: {
    backgroundColor: '#ffc107',
  },
  refreshButton: {
    backgroundColor: '#28a745',
    padding: 8,
    borderRadius: 4,
    alignItems: 'center',
    marginBottom: 10,
  },
  refreshButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  sessionInfo: {
    flex: 1,
  },
  sessionPlatform: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  sessionDetail: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  currentSessionBadge: {
    backgroundColor: '#28a745',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  currentSessionText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
