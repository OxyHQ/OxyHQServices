import type React from 'react';
import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import PinInput from '../../components/internal/PinInput';
import { useI18n } from '../../hooks/useI18n';

interface SignInTotpStepProps {
  // Common props
  colors: any;
  styles: any;
  theme: string;
  navigate: (screen: string, props?: Record<string, any>) => void;

  // Step navigation
  prevStep: () => void;
  nextStep: () => void;

  // Data
  username: string;
  mfaToken: string;

  // Context actions
  completeMfaLogin?: (mfaToken: string, code: string) => Promise<any>;

  // Error/loading
  errorMessage?: string;
  setErrorMessage?: (msg: string) => void;
  isLoading?: boolean;
}

const SignInTotpStep: React.FC<SignInTotpStepProps> = ({
  colors,
  styles,
  prevStep,
  nextStep,
  username,
  mfaToken,
  completeMfaLogin,
  errorMessage,
  setErrorMessage,
  isLoading,
}) => {
  const [code, setCode] = useState('');
  const inputRef = useRef<any>(null);
  const { t } = useI18n();

  const handleVerify = async () => {
    if (!code || code.length !== 6) {
      setErrorMessage?.(t('recover.enterCode'));
      return;
    }
    try {
      setErrorMessage?.('');
      await completeMfaLogin?.(mfaToken, code);
      // Login completed; higher-level navigation should continue automatically
    } catch (e: any) {
      setErrorMessage?.(e?.message || (t('signin.totp.invalidCode') || 'Invalid code. Please try again.'));
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <>
      <View style={styles.modernHeader}>
        <Text style={[styles.modernTitle, { color: colors.text }]}>{t('signin.totp.title') || 'Two‑Factor Code'}</Text>
        <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}> 
          {t('signin.totp.subtitle', { username }) || `Enter the 6‑digit code from your authenticator app for @${username}`}
        </Text>
      </View>

      <View style={styles.modernInputContainer}>
        <PinInput
          ref={inputRef}
          value={code}
          onChange={setCode}
          length={6}
          disabled={isLoading}
          autoFocus
          colors={colors}
        />

        {errorMessage ? (
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 16,
            padding: 12,
            backgroundColor: colors.error + '10',
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.error + '30',
          }}>
            <Ionicons name="alert-circle" size={20} color={colors.error} style={{ marginRight: 8 }} />
            <Text style={[styles.footerText, { color: colors.error, fontSize: 14 }]}>
              {errorMessage}
            </Text>
          </View>
        ) : null}
      </View>

      <GroupedPillButtons
        buttons={[
          { text: t('common.actions.back'), onPress: prevStep, icon: 'arrow-back', variant: 'transparent' },
          { text: t('signin.actions.verify'), onPress: handleVerify, icon: 'shield-checkmark', variant: 'primary', loading: isLoading, disabled: isLoading || code.length !== 6 },
        ]}
        colors={colors}
      />

      <View style={{ marginTop: 12, alignItems: 'center' }}>
        <Text style={[styles.footerText, { color: colors.secondaryText }]}>{t('signin.totp.noAccess') || 'No access to your authenticator?'}</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
          <TouchableOpacity onPress={() => navigate('RecoverAccount', { prefillUsername: username })}>
            <Text style={[styles.linkText, { color: colors.primary }]}>{t('signin.totp.useBackupCode') || 'Use backup code'}</Text>
          </TouchableOpacity>
          <Text style={[styles.footerText, { color: colors.secondaryText }]}>•</Text>
          <TouchableOpacity onPress={() => navigate('RecoverAccount', { prefillUsername: username })}>
            <Text style={[styles.linkText, { color: colors.primary }]}>{t('signin.totp.useRecoveryKey') || 'Use recovery key'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
};

export default SignInTotpStep;
