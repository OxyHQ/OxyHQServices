import type React from 'react';
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Platform,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BaseScreenProps } from '../types/navigation';
import Header from '../components/Header';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { H1, Text } from '@oxyhq/bloom/typography';
import { Button } from '@oxyhq/bloom/button';
import { TextField, TextFieldInput } from '@oxyhq/bloom/text-field';
import { useOxy } from '../context/OxyContext';
import { toast } from '@oxyhq/bloom';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,30}$/;
const DEBOUNCE_MS = 400;
const USERNAME_MAX = 30;
const DISPLAY_NAME_MAX = 50;
const BIO_MAX = 160;

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

  // Status icon + color shown alongside the username field message
  const usernameIsInvalid = usernameStatus === 'taken' || usernameStatus === 'invalid';
  const statusColor = usernameStatus === 'available'
    ? bloomTheme.colors.success
    : usernameIsInvalid
      ? bloomTheme.colors.negative
      : bloomTheme.colors.textSecondary;

  return (
    <View className="flex-1 bg-bg">
      <Header
        title="Create Identity"
        onBack={goBack}
        onClose={onClose}
        showBackButton={true}
        showCloseButton={true}
        elevation="subtle"
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-screen-margin pt-space-24 pb-space-32 gap-space-24"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Big Title */}
          <View className="gap-space-8">
            <H1 className="text-headerBold font-headerBold text-text">
              Create Identity
            </H1>
            <Text className="text-body font-body text-text-secondary">
              Create a managed identity that you control. It will have its own profile, posts, and interactions.
            </Text>
          </View>

          {/* Form Content */}
          <View className="gap-space-16 p-space-16 rounded-radius-20 bg-fill">
            {/* Username */}
            <View className="gap-space-8">
              <TextField isInvalid={usernameIsInvalid}>
                <TextFieldInput
                  floatingLabel
                  label="Username"
                  value={username}
                  onChangeText={handleUsernameChange}
                  isInvalid={usernameIsInvalid}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  maxLength={USERNAME_MAX}
                />
              </TextField>
              {(usernameStatus === 'checking' || usernameMessage) ? (
                <View className="flex-row items-center gap-space-4 px-space-4">
                  {usernameStatus === 'checking' ? (
                    <ActivityIndicator size="small" color={bloomTheme.colors.primary} />
                  ) : usernameStatus === 'available' ? (
                    <Ionicons name="checkmark-circle" size={16} color={bloomTheme.colors.success} />
                  ) : usernameIsInvalid ? (
                    <Ionicons name="alert-circle" size={16} color={bloomTheme.colors.negative} />
                  ) : null}
                  {usernameMessage ? (
                    <Text className="text-caption font-caption" style={{ color: statusColor }}>
                      {usernameMessage}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            {/* Display Name */}
            <TextField>
              <TextFieldInput
                floatingLabel
                label="Display Name"
                value={displayName}
                onChangeText={setDisplayName}
                maxLength={DISPLAY_NAME_MAX}
              />
            </TextField>

            {/* Bio */}
            <View className="gap-space-4">
              <TextField>
                <TextFieldInput
                  floatingLabel
                  label="Bio (optional)"
                  value={bio}
                  onChangeText={setBio}
                  maxLength={BIO_MAX}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </TextField>
              <Text className="text-caption font-caption text-text-tertiary px-space-4 text-right">
                {bio.length}/{BIO_MAX}
              </Text>
            </View>
          </View>

          {/* Create Button */}
          <Button
            variant="primary"
            onPress={handleCreate}
            disabled={!canCreate}
            loading={isCreating}
            accessibilityLabel="Create Identity"
            className="w-full"
          >
            Create Identity
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default CreateManagedAccountScreen;
