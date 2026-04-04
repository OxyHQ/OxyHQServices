import type React from 'react';
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { fontFamilies } from '../styles/fonts';
import { Header } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useOxy } from '../context/OxyContext';
import { toast } from '../../lib/sonner';
import { screenContentStyle } from '../constants/spacing';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,30}$/;
const DEBOUNCE_MS = 400;

const CreateManagedAccountScreen: React.FC<BaseScreenProps> = ({
  onClose,
  goBack,
}) => {
  const bloomTheme = useTheme();
  const { oxyServices, createManagedAccount, setActingAs } = useOxy();
  const { t } = useI18n();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [usernameMessage, setUsernameMessage] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced username availability check
  const checkUsername = useCallback((value: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!value || value.length < 3) {
      setUsernameStatus(value.length > 0 ? 'invalid' : 'idle');
      setUsernameMessage(value.length > 0 ? 'Username must be at least 3 characters' : '');
      return;
    }

    if (!USERNAME_REGEX.test(value)) {
      setUsernameStatus('invalid');
      setUsernameMessage('Only letters, numbers, hyphens, and underscores');
      return;
    }

    setUsernameStatus('checking');
    setUsernameMessage('');

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const result = await oxyServices.checkUsernameAvailability(value);
        setUsernameStatus(result.available ? 'available' : 'taken');
        setUsernameMessage(result.message || (result.available ? 'Username is available' : 'Username is taken'));
      } catch {
        setUsernameStatus('idle');
        setUsernameMessage('Could not check availability');
      }
    }, DEBOUNCE_MS);
  }, [oxyServices]);

  const handleUsernameChange = useCallback((value: string) => {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    setUsername(cleaned);
    checkUsername(cleaned);
  }, [checkUsername]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const canCreate = usernameStatus === 'available' && displayName.trim().length > 0 && !isCreating;

  const handleCreate = useCallback(async () => {
    if (!canCreate) return;

    setIsCreating(true);
    try {
      // Split display name into first/last
      const nameParts = displayName.trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

      const account = await createManagedAccount({
        username,
        name: { first: firstName, last: lastName },
        bio: bio.trim() || undefined,
      });

      toast.success('Identity created successfully');

      // Switch to the new managed account
      if (account.accountId) {
        setActingAs(account.accountId);
      }

      onClose?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create identity';
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  }, [canCreate, username, displayName, bio, createManagedAccount, setActingAs, onClose]);

  const getStatusColor = (): string => {
    switch (usernameStatus) {
      case 'available': return '#34C759';
      case 'taken':
      case 'invalid': return bloomTheme.colors.error;
      case 'checking': return bloomTheme.colors.primary;
      default: return 'transparent';
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
      <Header
        title="Create Identity"
        onBack={goBack}
        onClose={onClose}
        showBackButton={true}
        showCloseButton={true}
        elevation="subtle"
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={screenContentStyle}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.description, { color: bloomTheme.colors.text }]}>
            Create a managed identity that you control. It will have its own profile, posts, and interactions.
          </Text>

          {/* Username */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: bloomTheme.colors.text }]}>Username</Text>
            <View style={[
              styles.inputContainer,
              { borderColor: usernameStatus !== 'idle' ? getStatusColor() : bloomTheme.colors.border },
            ]}>
              <Text style={[styles.inputPrefix, { color: bloomTheme.colors.text + '80' }]}>@</Text>
              <TextInput
                style={[styles.input, { color: bloomTheme.colors.text }]}
                value={username}
                onChangeText={handleUsernameChange}
                placeholder="username"
                placeholderTextColor={bloomTheme.colors.text + '40'}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                maxLength={30}
              />
              {usernameStatus === 'checking' && (
                <ActivityIndicator size="small" color={bloomTheme.colors.primary} />
              )}
              {usernameStatus === 'available' && (
                <Text style={styles.statusIcon}>OK</Text>
              )}
            </View>
            {usernameMessage ? (
              <Text style={[styles.statusMessage, { color: getStatusColor() }]}>
                {usernameMessage}
              </Text>
            ) : null}
          </View>

          {/* Display Name */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: bloomTheme.colors.text }]}>Display Name</Text>
            <View style={[styles.inputContainer, { borderColor: bloomTheme.colors.border }]}>
              <TextInput
                style={[styles.input, { color: bloomTheme.colors.text }]}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Display name"
                placeholderTextColor={bloomTheme.colors.text + '40'}
                maxLength={50}
              />
            </View>
          </View>

          {/* Bio */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: bloomTheme.colors.text }]}>Bio (optional)</Text>
            <View style={[styles.inputContainer, styles.bioContainer, { borderColor: bloomTheme.colors.border }]}>
              <TextInput
                style={[styles.input, styles.bioInput, { color: bloomTheme.colors.text }]}
                value={bio}
                onChangeText={setBio}
                placeholder="Tell people about this identity"
                placeholderTextColor={bloomTheme.colors.text + '40'}
                maxLength={160}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
            <Text style={[styles.charCount, { color: bloomTheme.colors.text + '60' }]}>
              {bio.length}/160
            </Text>
          </View>

          {/* Create Button */}
          <TouchableOpacity
            style={[
              styles.createButton,
              { backgroundColor: bloomTheme.colors.primary },
              !canCreate && styles.createButtonDisabled,
            ]}
            onPress={handleCreate}
            disabled={!canCreate}
            activeOpacity={0.7}
          >
            {isCreating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.createButtonText}>Create Identity</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
    fontFamily: fontFamilies.inter,
  },
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: Platform.OS === 'web' ? '600' : undefined,
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
  },
  inputPrefix: {
    fontSize: 16,
    fontFamily: fontFamilies.inter,
    marginRight: 2,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: fontFamilies.inter,
    paddingVertical: 0,
  },
  bioContainer: {
    height: 88,
    alignItems: 'flex-start',
    paddingVertical: 12,
  },
  bioInput: {
    height: 64,
  },
  statusIcon: {
    fontSize: 13,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: Platform.OS === 'web' ? '600' : undefined,
    color: '#34C759',
  },
  statusMessage: {
    fontSize: 13,
    fontFamily: fontFamilies.inter,
    marginTop: 6,
  },
  charCount: {
    fontSize: 12,
    fontFamily: fontFamilies.inter,
    textAlign: 'right',
    marginTop: 4,
  },
  createButton: {
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: Platform.OS === 'web' ? '600' : undefined,
  },
});

export default CreateManagedAccountScreen;
