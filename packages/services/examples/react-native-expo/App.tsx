/**
 * Zero-Config Authentication Example - React Native Expo App
 * 
 * This example demonstrates how to set up OxyHQ Services authentication
 * in a React Native Expo application with minimal configuration.
 * Works on iOS, Android, and Web.
 */

import 'react-native-url-polyfill/auto'; // Required polyfill for React Native
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { AuthProvider, useAuth, useAuthStatus } from '@oxyhq/services';

// Navigation setup
const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// =============================================================================
// MAIN APP COMPONENT
// =============================================================================

export default function App() {
  return (
    <AuthProvider baseURL="https://api.oxy.so">
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}

// =============================================================================
// NAVIGATION COMPONENTS
// =============================================================================

function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuthStatus();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated ? (
        <Stack.Screen name="MainTabs" component={MainTabNavigator} />
      ) : (
        <>
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

function MainTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#8E8E93',
        headerShown: true,
      }}
    >
      <Tab.Screen 
        name="Home" 
        component={HomeScreen}
        options={{ title: 'Home' }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen}
        options={{ title: 'Profile' }}
      />
    </Tab.Navigator>
  );
}

// =============================================================================
// SCREEN COMPONENTS
// =============================================================================

function WelcomeScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.welcomeContainer}>
        <Text style={styles.title}>Welcome to OxyHQ</Text>
        <Text style={styles.subtitle}>
          Zero-config authentication for React Native
        </Text>
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            style={[styles.button, styles.primaryButton]}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.primaryButtonText}>Sign In</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.button, styles.secondaryButton]}
            onPress={() => navigation.navigate('Register')}
          >
            <Text style={styles.secondaryButtonText}>Sign Up</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function LoginScreen({ navigation }: any) {
  const { login, error, clearError, isLoading } = useAuth();
  const [formData, setFormData] = React.useState({
    username: '',
    password: '',
  });

  const handleLogin = async () => {
    try {
      clearError();
      await login(formData.username, formData.password);
      // Navigation happens automatically via auth state change
    } catch (err) {
      // Error is automatically set in auth state
      console.error('Login failed:', err);
    }
  };

  useEffect(() => {
    if (error) {
      Alert.alert('Login Failed', error);
    }
  }, [error]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.formContainer}>
        <Text style={styles.title}>Sign In</Text>
        
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Username or Email</Text>
          <TextInput
            style={styles.input}
            value={formData.username}
            onChangeText={(text) => setFormData(prev => ({ ...prev, username: text }))}
            placeholder="Enter your username"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={formData.password}
            onChangeText={(text) => setFormData(prev => ({ ...prev, password: text }))}
            placeholder="Enter your password"
            secureTextEntry
            editable={!isLoading}
          />
        </View>

        <TouchableOpacity
          style={[styles.button, styles.primaryButton, isLoading && styles.disabledButton]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.primaryButtonText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => navigation.navigate('Register')}
          disabled={isLoading}
        >
          <Text style={styles.linkText}>Don't have an account? Sign up</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function RegisterScreen({ navigation }: any) {
  const { register, checkUsernameAvailability, checkEmailAvailability, error, clearError, isLoading } = useAuth();
  const [formData, setFormData] = React.useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [validation, setValidation] = React.useState({
    username: null as boolean | null,
    email: null as boolean | null,
    passwordMatch: true,
  });

  const handleRegister = async () => {
    if (formData.password !== formData.confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    try {
      clearError();
      await register(formData.username, formData.email, formData.password);
      // Navigation happens automatically via auth state change
    } catch (err) {
      console.error('Registration failed:', err);
    }
  };

  const handleUsernameChange = async (text: string) => {
    setFormData(prev => ({ ...prev, username: text }));
    
    if (text.length >= 3) {
      try {
        const result = await checkUsernameAvailability(text);
        setValidation(prev => ({ ...prev, username: result.available }));
      } catch (error) {
        console.error('Username validation error:', error);
      }
    } else {
      setValidation(prev => ({ ...prev, username: null }));
    }
  };

  const handleEmailChange = async (text: string) => {
    setFormData(prev => ({ ...prev, email: text }));
    
    if (text.includes('@')) {
      try {
        const result = await checkEmailAvailability(text);
        setValidation(prev => ({ ...prev, email: result.available }));
      } catch (error) {
        console.error('Email validation error:', error);
      }
    } else {
      setValidation(prev => ({ ...prev, email: null }));
    }
  };

  const handlePasswordConfirmChange = (text: string) => {
    setFormData(prev => ({ ...prev, confirmPassword: text }));
    setValidation(prev => ({ 
      ...prev, 
      passwordMatch: text === formData.password 
    }));
  };

  useEffect(() => {
    if (error) {
      Alert.alert('Registration Failed', error);
    }
  }, [error]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.formContainer}>
        <Text style={styles.title}>Sign Up</Text>
        
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={[
              styles.input,
              validation.username === false && styles.invalidInput
            ]}
            value={formData.username}
            onChangeText={handleUsernameChange}
            placeholder="Choose a username"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />
          {validation.username === false && (
            <Text style={styles.errorText}>Username is already taken</Text>
          )}
          {validation.username === true && (
            <Text style={styles.successText}>Username is available</Text>
          )}
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[
              styles.input,
              validation.email === false && styles.invalidInput
            ]}
            value={formData.email}
            onChangeText={handleEmailChange}
            placeholder="Enter your email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />
          {validation.email === false && (
            <Text style={styles.errorText}>Email is already registered</Text>
          )}
          {validation.email === true && (
            <Text style={styles.successText}>Email is available</Text>
          )}
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={formData.password}
            onChangeText={(text) => {
              setFormData(prev => ({ ...prev, password: text }));
              setValidation(prev => ({ 
                ...prev, 
                passwordMatch: text === formData.confirmPassword 
              }));
            }}
            placeholder="Create a password"
            secureTextEntry
            editable={!isLoading}
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Confirm Password</Text>
          <TextInput
            style={[
              styles.input,
              !validation.passwordMatch && styles.invalidInput
            ]}
            value={formData.confirmPassword}
            onChangeText={handlePasswordConfirmChange}
            placeholder="Confirm your password"
            secureTextEntry
            editable={!isLoading}
          />
          {!validation.passwordMatch && (
            <Text style={styles.errorText}>Passwords do not match</Text>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.button, 
            styles.primaryButton, 
            (isLoading || validation.username === false || validation.email === false || !validation.passwordMatch) && styles.disabledButton
          ]}
          onPress={handleRegister}
          disabled={isLoading || validation.username === false || validation.email === false || !validation.passwordMatch}
        >
          {isLoading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.primaryButtonText}>Sign Up</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => navigation.navigate('Login')}
          disabled={isLoading}
        >
          <Text style={styles.linkText}>Already have an account? Sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function HomeScreen() {
  const { user } = useAuth();
  
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <Text style={styles.title}>Welcome Back!</Text>
        <Text style={styles.subtitle}>Hello, {user?.username}! 👋</Text>
        
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Zero-Config Authentication</Text>
          <Text style={styles.cardText}>
            You're successfully authenticated with OxyHQ Services using zero configuration!
            No manual token handling, no interceptors, just authentication that works.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account Status</Text>
          <Text style={styles.statusText}>✅ Authentication: Active</Text>
          <Text style={styles.statusText}>✅ Profile: Complete</Text>
          <Text style={styles.statusText}>✅ Session: Valid</Text>
          <Text style={styles.statusText}>✅ Cross-Platform: React Native</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileScreen() {
  const { user, logout } = useAuth();
  
  const handleLogout = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Sign Out', 
          style: 'destructive',
          onPress: async () => {
            try {
              await logout();
              // Navigation happens automatically
            } catch (error) {
              console.error('Logout failed:', error);
            }
          }
        }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <View style={styles.profileCard}>
          <Text style={styles.profileName}>{user?.username}</Text>
          <Text style={styles.profileEmail}>{user?.email}</Text>
          <Text style={styles.profileId}>ID: {user?.id}</Text>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity style={[styles.button, styles.secondaryButton]}>
            <Text style={styles.secondaryButtonText}>Edit Profile</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.button, styles.dangerButton]}
            onPress={handleLogout}
          >
            <Text style={styles.dangerButtonText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#8E8E93',
  },
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  formContainer: {
    padding: 20,
    paddingTop: 60,
  },
  screenContainer: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#8E8E93',
    marginBottom: 40,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000000',
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  invalidInput: {
    borderColor: '#FF3B30',
  },
  buttonContainer: {
    gap: 15,
  },
  button: {
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  secondaryButtonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  dangerButton: {
    backgroundColor: '#FF3B30',
  },
  dangerButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
  linkButton: {
    marginTop: 20,
    padding: 10,
    alignItems: 'center',
  },
  linkText: {
    color: '#007AFF',
    fontSize: 16,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
    marginTop: 5,
  },
  successText: {
    color: '#34C759',
    fontSize: 14,
    marginTop: 5,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 10,
  },
  cardText: {
    fontSize: 15,
    color: '#8E8E93',
    lineHeight: 22,
  },
  statusText: {
    fontSize: 15,
    color: '#34C759',
    marginBottom: 5,
  },
  profileCard: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 30,
    marginBottom: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  profileName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 5,
  },
  profileEmail: {
    fontSize: 16,
    color: '#8E8E93',
    marginBottom: 10,
  },
  profileId: {
    fontSize: 12,
    color: '#C7C7CC',
    fontFamily: 'monospace',
  },
});