import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/TextField';
import { useI18n } from '../../hooks/useI18n';
import { STEP_GAP, STEP_INNER_GAP, stepStyles } from '../../styles/spacing';

interface RecoverResetPasswordStepProps {
  // Common props
  colors: any;
  styles: any;
  theme: string;
  navigate: (screen: RouteName, props?: Record<string, any>) => void;

  // Navigation
  nextStep: () => void;
  prevStep: () => void;

  // From previous steps
  identifier: string;
  verificationCode: string;

  // Local state
  password: string;
  confirmPassword: string;
  setPassword: (s: string) => void;
  setConfirmPassword: (s: string) => void;
  errorMessage: string;
  setErrorMessage: (s: string) => void;
  isLoading: boolean;
  setIsLoading: (b: boolean) => void;

  // Services
  oxyServices: any;
}

const RecoverResetPasswordStep: React.FC<RecoverResetPasswordStepProps> = ({
  colors,
  styles,
  nextStep,
  prevStep,
  identifier,
  verificationCode,
  password,
  confirmPassword,
  setPassword,
  setConfirmPassword,
  errorMessage,
  setErrorMessage,
  isLoading,
  setIsLoading,
  oxyServices,
}) => {
  const { t } = useI18n();
  const baseStyles = stepStyles;
  const webShadowReset = Platform.OS === 'web' ? ({ boxShadow: 'none' } as any) : null;
  const handleReset = async () => {
    if (!password || password.length < 8) {
      setErrorMessage(t('recover.password.minLength') || 'Password must be at least 8 characters long');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage(t('recover.password.mismatch') || 'Passwords do not match');
      return;
    }
    setErrorMessage('');
    setIsLoading(true);
    try {
      const code = verificationCode?.trim();
      if (!code) throw new Error(t('recover.missingCode') || 'Missing code');

      // Heuristic: recovery key starts with 'oxy-' or longer strings, backup codes have dashes of short format, else assume TOTP
      if (code.toLowerCase().startsWith('oxy-') || code.length >= 16) {
        await oxyServices.resetPasswordWithRecoveryKey(identifier, code, password);
      } else if (/[A-Za-z0-9]+-[A-Za-z0-9]+/.test(code)) {
        await oxyServices.resetPasswordWithBackupCode(identifier, code, password);
      } else {
        await oxyServices.resetPasswordWithTotp(identifier, code, password);
      }
      nextStep();
    } catch (e: any) {
      setErrorMessage(e?.message || t('recover.password.resetFailed') || 'Failed to reset password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <View style={[baseStyles.container, { marginBottom: STEP_GAP }, baseStyles.header]}>
        <Text style={[styles.modernTitle, baseStyles.title, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>{t('recover.newPassword')}</Text>
        <Text style={[styles.modernSubtitle, baseStyles.subtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>{t('recover.title')} @{identifier}</Text>
      </View>

      <View style={[baseStyles.container, { marginBottom: STEP_GAP }]}>
        <View style={[stylesheet.formCard, { backgroundColor: colors.inputBackground || colors.card || 'rgba(0,0,0,0.04)' }, webShadowReset]}>
          <TextField
            label={t('common.labels.password')}
            leading={<Ionicons name="lock-closed-outline" size={24} color={colors.secondaryText} />}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            variant="filled"
            error={errorMessage || undefined}
            onSubmitEditing={handleReset}
            autoFocus
            style={{ marginBottom: 0 }}
          />

          <TextField
            label={t('common.labels.confirmPassword')}
            leading={<Ionicons name="lock-closed-outline" size={24} color={colors.secondaryText} />}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            variant="filled"
            onSubmitEditing={handleReset}
            style={{ marginBottom: 0 }}
          />
        </View>
      </View>

      <View style={[baseStyles.container, { marginBottom: 0 }, baseStyles.buttonContainer]}>
        <GroupedPillButtons
          buttons={[
            { text: t('common.actions.back'), onPress: prevStep, icon: 'arrow-back', variant: 'transparent' },
            {
              text: t('common.actions.resetPassword'),
              onPress: handleReset,
              icon: 'key-outline',
              variant: 'primary',
              loading: isLoading,
              disabled: isLoading || !password || password.length < 8 || password !== confirmPassword
            },
          ]}
          colors={colors}
        />
      </View>
    </>
  );
};

export default RecoverResetPasswordStep;

const stylesheet = StyleSheet.create({
  formCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: STEP_INNER_GAP,
    alignItems: 'stretch',
    shadowColor: 'transparent',
  },
});
