import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet, type ViewStyle, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import PinInput, { type PinInputHandle } from '../../components/internal/PinInput';
import { useI18n } from '../../hooks/useI18n';
import { STEP_GAP, STEP_INNER_GAP, stepStyles } from '../../styles/spacing';

interface SignInTotpStepProps {
  // Common props
  colors: any;
  styles: any;
  theme: string;
  navigate: (screen: RouteName, props?: Record<string, any>) => void;

  // Step navigation
  prevStep: () => void;
  nextStep: () => void;

  // Data
  username: string;
  mfaToken: string;

  // Context actions
  completeMfaLogin?: (mfaToken: string, code: string) => Promise<any>;
  onAuthenticated?: (user?: unknown) => void;

  // Error/loading
  errorMessage?: string;
  setErrorMessage?: (msg: string) => void;
  isLoading?: boolean;
}

const SignInTotpStep: React.FC<SignInTotpStepProps> = ({
  colors,
  styles,
  navigate,
  prevStep,
  nextStep,
  username,
  mfaToken,
  completeMfaLogin,
  onAuthenticated,
  errorMessage,
  setErrorMessage,
  isLoading,
}) => {
  const [code, setCode] = useState('');
  const inputRef = useRef<PinInputHandle | null>(null);
  const { t } = useI18n();
  const baseStyles = stepStyles;
  const webShadowReset = Platform.OS === 'web' ? ({ boxShadow: 'none' } as any) : null;

  const handleVerify = async () => {
    if (!code || code.length !== 6) {
      setErrorMessage?.(t('recover.enterCode'));
      return;
    }
    try {
      setErrorMessage?.('');
      const user = await completeMfaLogin?.(mfaToken, code);
      // Login completed; call onAuthenticated to close bottom sheet
      if (onAuthenticated && user) {
        onAuthenticated(user);
      }
    } catch (e: any) {
      setErrorMessage?.(e?.message || (t('signin.totp.invalidCode') || 'Invalid code. Please try again.'));
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <>
      <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.header]}>
        <Text style={[styles.modernTitle, baseStyles.title, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>{t('signin.totp.title') || 'Two‑Factor Code'}</Text>
        <Text style={[styles.modernSubtitle, baseStyles.subtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}> 
          {t('signin.totp.subtitle', { username }) || `Enter the 6‑digit code from your authenticator app for @${username}`}
        </Text>
      </View>

      <View style={[baseStyles.container, baseStyles.sectionSpacing, stylesheet.inputSection]}>
        <View style={stylesheet.pinInputWrapper}>
          <PinInput
            ref={inputRef}
            value={code}
            onChange={setCode}
            length={6}
            disabled={isLoading}
            autoFocus
            colors={colors}
          />
        </View>

        {errorMessage ? (
          <View style={[
            stylesheet.errorContainer,
            {
              backgroundColor: colors.error + '10',
              borderColor: colors.error + '30',
            },
            webShadowReset,
          ]}>
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <Text style={[styles.footerText, { color: colors.error, fontSize: 14 }]}>
              {errorMessage}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.buttonContainer]}>
        <GroupedPillButtons
          buttons={[
            { text: t('common.actions.back'), onPress: prevStep, icon: 'arrow-back', variant: 'transparent' },
            { text: t('signin.actions.verify'), onPress: handleVerify, icon: 'shield-checkmark', variant: 'primary', loading: isLoading, disabled: isLoading || code.length !== 6 },
          ]}
          colors={colors}
        />
      </View>

      <View style={[baseStyles.container, baseStyles.sectionSpacing, stylesheet.footerContainer]}>
        <Text style={[styles.footerText, { color: colors.secondaryText }]}>{t('signin.totp.noAccess') || 'No access to your authenticator?'}</Text>
        <View style={stylesheet.footerLinks}>
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

const stylesheet = StyleSheet.create({
    inputSection: {
        gap: STEP_INNER_GAP,
    },
    pinInputWrapper: {
        marginBottom: 0,
        marginTop: 0,
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 0,
        padding: STEP_INNER_GAP,
        borderRadius: 8,
        borderWidth: 1,
        shadowColor: 'transparent',
        gap: STEP_INNER_GAP,
    },
    footerContainer: {
        alignItems: 'center',
        gap: STEP_INNER_GAP,
    },
    footerLinks: {
        flexDirection: 'row',
        gap: STEP_INNER_GAP,
        marginTop: 0,
    },
});
