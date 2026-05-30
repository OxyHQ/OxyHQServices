import React, { useCallback, useState } from 'react';
import { View, StyleSheet, TextInput, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { Button, ImportantBanner, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy } from '@oxyhq/services';
import { alert, toast } from '@oxyhq/bloom';
import { KeyManager } from '@oxyhq/core';
import { useTranslation } from '@/lib/i18n';
import { runAccountDeletion } from '@/lib/account/delete-account-flow';

/**
 * Account Deletion Screen.
 *
 * Permanent, irreversible. The API requires a cryptographic signature
 * produced by this device's identity private key — there is no password.
 * The user must also type their username verbatim as a confirmation.
 */
export default function DeleteAccountScreen() {
  const colors = useColors();
  const router = useRouter();
  // Auth is enforced by the `(tabs)` layout — assume a session here.
  const { user, isLoading: oxyLoading, oxyServices, logoutAll } = useOxy();
  const { t } = useTranslation();

  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const username = user?.username ?? '';
  const isConfirmValid = confirmText === username && username.length > 0;

  const handleDelete = useCallback(async () => {
    if (!isConfirmValid || !oxyServices) return;

    setIsDeleting(true);
    try {
      // Pre-flight: identity key must exist on this device to sign the delete request.
      const hasIdentity = await KeyManager.hasIdentity();
      if (!hasIdentity) {
        alert(
          t('data.deleteAccount.identityRequiredTitle'),
          t('data.deleteAccount.identityRequiredMessage'),
        );
        return;
      }

      // Server-side delete → purge the local identity (primary + backup) →
      // sign out. The purge runs ONLY after the server confirms deletion, so a
      // failed delete never strands the user without their keys. See
      // `runAccountDeletion` for the full ordering/safety contract.
      const { localIdentityPurged } = await runAccountDeletion(confirmText, {
        deleteAccount: (text) => oxyServices.deleteAccount(text),
        // skipBackup=true (no point backing up keys for a deleted account),
        // force=true (also purges the backup slot, no re-prompt), and
        // userConfirmed=true (the user already confirmed via username match +
        // the cryptographic signature this device produced).
        purgeIdentity: () => KeyManager.deleteIdentity(true, true, true),
        signOutAll: () => logoutAll(),
      });

      // The account is gone server-side regardless. If the local key purge
      // failed, surface a non-fatal warning so the user knows to reinstall to
      // fully clear residual key material.
      if (!localIdentityPurged) {
        toast.error(t('data.deleteAccount.localKeyPurgeWarning'));
      }

      router.replace('/');
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('data.deleteAccount.failedDefault');
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  }, [isConfirmValid, oxyServices, confirmText, logoutAll, router, alert, t]);

  if (oxyLoading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>{t('common.loadingShort')}</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  const renderContent = () => (
    <>
      <ScreenHeader
        title={t('data.deleteAccount.title')}
        subtitle={t('data.deleteAccount.subtitle')}
      />

      <ImportantBanner title={t('data.deleteAccount.permanentTitle')} icon="alert-octagon">
        {t('data.deleteAccount.permanentBody', { name: username || t('data.deleteAccount.thisAccount') })}
      </ImportantBanner>

      <Section title={t('data.deleteAccount.whatDeleted')}>
        <View style={[styles.bulletList, { backgroundColor: colors.card }]}>
          {[
            t('data.deleteAccount.items.profile'),
            t('data.deleteAccount.items.mailboxes'),
            t('data.deleteAccount.items.sessions'),
            t('data.deleteAccount.items.settings'),
          ].map((item) => (
            <View key={item} style={styles.bulletRow}>
              <MaterialCommunityIcons
                name="close-circle-outline"
                size={18}
                color={colors.error}
                style={styles.bulletIcon}
              />
              <ThemedText style={[styles.bulletText, { color: colors.text }]}>{item}</ThemedText>
            </View>
          ))}
        </View>
      </Section>

      <Section title={t('data.deleteAccount.confirm')}>
        <ThemedText style={[styles.label, { color: colors.text }]}>
          {t('data.deleteAccount.typeUsername')} <ThemedText style={[styles.usernameHint, { color: colors.error }]}>{username}</ThemedText>
        </ThemedText>
        <View
          style={[
            styles.inputWrapper,
            {
              backgroundColor: colors.card,
              borderColor: confirmText.length > 0 && !isConfirmValid ? colors.error : colors.border,
            },
          ]}
        >
          <TextInput
            style={[styles.input, { color: colors.text }]}
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder={username}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isDeleting}
            accessibilityLabel={t('data.deleteAccount.confirmInputLabel')}
          />
        </View>
        {confirmText.length > 0 && !isConfirmValid && (
          <ThemedText style={[styles.errorText, { color: colors.error }]}>
            {t('data.deleteAccount.usernameMismatch')}
          </ThemedText>
        )}

        <View style={styles.buttonRow}>
          <Button
            variant="secondary"
            onPress={() => router.back()}
            disabled={isDeleting}
            style={styles.buttonFlex}
          >
            {t('data.deleteAccount.cancel')}
          </Button>
          <Button
            variant="primary"
            onPress={handleDelete}
            loading={isDeleting}
            disabled={!isConfirmValid || isDeleting}
            style={styles.buttonFlex}
          >
            {isDeleting ? t('data.deleteAccount.deleting') : t('data.deleteAccount.deleteCta')}
          </Button>
        </View>
      </Section>
    </>
  );

  if (Platform.OS === 'web') {
    return renderContent();
  }

  return (
    <ScreenContentWrapper>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {renderContent()}
      </ScrollView>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    opacity: 0.7,
  },
  bulletList: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bulletIcon: {
    marginTop: 2,
    marginRight: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  usernameHint: {
    fontWeight: '700',
  },
  inputWrapper: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  input: {
    fontSize: 16,
    paddingVertical: 12,
  },
  errorText: {
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  buttonFlex: {
    flex: 1,
  },
});
