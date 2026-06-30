import type React from 'react';
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Platform,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AccountKind, CreateAccountInput } from '@oxyhq/core';
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

/** Kind of account this screen can create. `personal` is a signup-minted root and is never created here. */
type CreatableAccountKind = Exclude<AccountKind, 'personal'>;

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,30}$/;
const DEBOUNCE_MS = 400;
const USERNAME_MAX = 30;
const DISPLAY_NAME_MAX = 50;
const BIO_MAX = 160;

interface KindOption {
  value: CreatableAccountKind;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

// The creatable account kinds, matching the API `createAccountSchema` enum.
// Order places the most common choice (a project / persona) first.
const KIND_OPTIONS: KindOption[] = [
  { value: 'project', icon: 'cube-outline' },
  { value: 'organization', icon: 'business-outline' },
  { value: 'bot', icon: 'hardware-chip-outline' },
];

const kindLabel = (
  t: (key: string, vars?: Record<string, string | number>) => string,
  kind: CreatableAccountKind,
): string => {
  switch (kind) {
    case 'organization':
      return t('accounts.kinds.organization.label') || 'Organization';
    case 'bot':
      return t('accounts.kinds.bot.label') || 'Bot';
    default:
      return t('accounts.kinds.project.label') || 'Project';
  }
};

const kindDescription = (
  t: (key: string, vars?: Record<string, string | number>) => string,
  kind: CreatableAccountKind,
): string => {
  switch (kind) {
    case 'organization':
      return t('accounts.kinds.organization.description') || 'A shared team account with members';
    case 'bot':
      return t('accounts.kinds.bot.description') || 'A programmatic account with service credentials';
    default:
      return t('accounts.kinds.project.description') || 'A separate account you control';
  }
};

/**
 * Create a new account in the unified account graph (an organization, project,
 * or bot). The caller becomes its owner. Optionally nested under a parent
 * account via the `parentAccountId` prop. NOT the cryptographic Commons/DID
 * "identity" — that is a separate concept.
 */
const CreateAccountScreen: React.FC<BaseScreenProps> = ({
  onClose,
  goBack,
  parentAccountId,
}) => {
  const bloomTheme = useTheme();
  const { oxyServices, createAccount, setActingAs } = useOxy();
  const { t } = useI18n();

  const parentId = typeof parentAccountId === 'string' ? parentAccountId : undefined;

  const [kind, setKind] = useState<CreatableAccountKind>('project');
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
      setUsernameMessage(
        value.length > 0
          ? (t('accounts.create.username.tooShort') || 'Username must be at least 3 characters')
          : '',
      );
      return;
    }

    if (!USERNAME_REGEX.test(value)) {
      setUsernameStatus('invalid');
      setUsernameMessage(
        t('accounts.create.username.invalidChars') || 'Only letters, numbers, hyphens, and underscores',
      );
      return;
    }

    setUsernameStatus('checking');
    setUsernameMessage('');

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const result = await oxyServices.checkUsernameAvailability(value);
        setUsernameStatus(result.available ? 'available' : 'taken');
        setUsernameMessage(
          result.message
          || (result.available
            ? (t('accounts.create.username.available') || 'Username is available')
            : (t('accounts.create.username.taken') || 'Username is taken')),
        );
      } catch {
        setUsernameStatus('idle');
        setUsernameMessage(t('accounts.create.username.checkFailed') || 'Could not check availability');
      }
    }, DEBOUNCE_MS);
  }, [oxyServices, t]);

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

      const input: CreateAccountInput = {
        kind,
        username,
        name: { first: firstName, last: lastName },
        bio: bio.trim() || undefined,
        ...(parentId ? { parentAccountId: parentId } : null),
      };
      const account = await createAccount(input);

      toast.success(t('accounts.create.toasts.success') || 'Account created');

      // Switch to the new account
      if (account.accountId) {
        setActingAs(account.accountId);
      }

      onClose?.();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : (t('accounts.create.toasts.failed') || 'Failed to create account');
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  }, [canCreate, kind, username, displayName, bio, parentId, createAccount, setActingAs, onClose, t]);

  // Status icon + color shown alongside the username field message
  const usernameIsInvalid = usernameStatus === 'taken' || usernameStatus === 'invalid';
  const statusColor = usernameStatus === 'available'
    ? bloomTheme.colors.success
    : usernameIsInvalid
      ? bloomTheme.colors.negative
      : bloomTheme.colors.textSecondary;

  const title = t('accounts.create.title') || 'Create account';

  return (
    <View className="flex-1 bg-bg">
      <Header
        title={title}
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
              {title}
            </H1>
            <Text className="text-body font-body text-text-secondary">
              {t('accounts.create.subtitle')
                || 'Create an account you control. It will have its own profile, members, and apps.'}
            </Text>
          </View>

          {/* Kind picker */}
          <View className="gap-space-8">
            {KIND_OPTIONS.map((option) => {
              const selected = option.value === kind;
              return (
                <TouchableOpacity
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={kindLabel(t, option.value)}
                  onPress={() => setKind(option.value)}
                  activeOpacity={0.7}
                  className="flex-row items-center gap-space-12 p-space-16 rounded-radius-20"
                  style={{
                    backgroundColor: selected ? bloomTheme.colors.primarySubtle : bloomTheme.colors.card,
                    borderWidth: 1,
                    borderColor: selected ? bloomTheme.colors.primary : bloomTheme.colors.border,
                  }}
                >
                  <Ionicons
                    name={option.icon}
                    size={22}
                    color={selected ? bloomTheme.colors.primary : bloomTheme.colors.icon}
                  />
                  <View className="flex-1">
                    <Text
                      className="text-body font-bodyBold"
                      style={{ color: selected ? bloomTheme.colors.primary : bloomTheme.colors.text }}
                    >
                      {kindLabel(t, option.value)}
                    </Text>
                    <Text className="text-caption font-caption text-text-secondary">
                      {kindDescription(t, option.value)}
                    </Text>
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={20} color={bloomTheme.colors.primary} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Form Content */}
          <View className="gap-space-16 p-space-16 rounded-radius-20 bg-fill">
            {/* Username */}
            <View className="gap-space-8">
              <TextField isInvalid={usernameIsInvalid}>
                <TextFieldInput
                  floatingLabel
                  label={t('accounts.create.username.label') || 'Username'}
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
                label={t('accounts.create.displayName.label') || 'Display name'}
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
                  label={t('accounts.create.bio.label') || 'Bio (optional)'}
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
            accessibilityLabel={title}
            className="w-full"
          >
            {title}
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default CreateAccountScreen;
