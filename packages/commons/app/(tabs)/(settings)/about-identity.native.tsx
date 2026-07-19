import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Share,
  Platform,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard, ScreenHeader, Button, ImportantBanner } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy } from '@oxyhq/services';
import { alert, toast } from '@oxyhq/bloom';
import { useIdentity } from '@/hooks/useIdentity';
import { useAvatarUrl } from '@/hooks/useAvatarUrl';
import { getDisplayName } from '@/utils/date-utils';
import { IdentityCard } from '@/components/identity';
import { useTranslation } from '@/lib/i18n';

export default function AboutIdentityScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  // Auth is enforced by the `(vault)` layout — assume a session here.
  const { user, isLoading: oxyLoading, oxyServices, showBottomSheet } = useOxy();
  const { getPublicKey } = useIdentity();

  const displayName = useMemo(() => getDisplayName(user), [user]);
  const avatarUrl = useAvatarUrl(user);

  // DID-only QR payload, revealed by a long-press on the card.
  const qrPayload = useMemo(() => {
    if (!oxyServices) return undefined;
    try {
      return oxyServices.getMyIdPayload();
    } catch (error) {
      console.error('[AboutIdentity] Failed to build ID payload', error);
      return undefined;
    }
  }, [oxyServices, user?.id]);

  const handleEditName = useCallback(() => {
    showBottomSheet?.({
      screen: 'EditProfileField',
      props: { fieldType: 'displayName' }
    });
  }, [showBottomSheet]);

  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSavingExpiration, setIsSavingExpiration] = useState(false);

  useEffect(() => {
    const loadPublicKey = async () => {
      try {
        if (getPublicKey) {
          const pk = await getPublicKey();
          setPublicKey(pk);
        }
      } catch (err) {
        console.error('Failed to get public key:', err);
      } finally {
        setLoading(false);
      }
    };

    loadPublicKey();
  }, [getPublicKey]);

  const handleCopyPublicKey = useCallback(async () => {
    if (!publicKey) return;

    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(publicKey);
        toast.success(t('aboutIdentity.publicKeyCopied'));
      } catch {
        toast.error(t('aboutIdentity.copyFailed'));
      }
    } else {
      try {
        await Share.share({ message: publicKey });
      } catch {
        // Cancelled - don't show error
      }
    }
  }, [publicKey, t]);

  // Format expiration setting for display
  const formatExpirationSetting = useCallback((days: number | null | undefined): string => {
    if (!days || days === null) return t('aboutIdentity.expiration.never');
    if (days === 365) return t('aboutIdentity.expiration.oneYear');
    return t('aboutIdentity.expiration.days', { count: days });
  }, [t]);

  // Get current expiration setting
  const currentExpirationDays = user?.accountExpiresAfterInactivityDays ?? null;

  // Handle expiration setting change
  const handleExpirationChange = useCallback(async (selectedDays: number | null) => {
    if (!oxyServices || !user) return;

    try {
      setIsSavingExpiration(true);
      await oxyServices.updateProfile({ accountExpiresAfterInactivityDays: selectedDays });
      // User object from useOxy should update automatically via the context
      toast.success(t('aboutIdentity.expirationUpdated'));
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : t('aboutIdentity.expirationUpdateFailed');
      toast.error(message);
    } finally {
      setIsSavingExpiration(false);
    }
  }, [oxyServices, user, t]);

  // Show expiration selection dialog
  const showExpirationPicker = useCallback(() => {
    const options = [
      { label: t('aboutIdentity.expirationPicker.days30'), value: 30 },
      { label: t('aboutIdentity.expirationPicker.days90'), value: 90 },
      { label: t('aboutIdentity.expirationPicker.days180'), value: 180 },
      { label: t('aboutIdentity.expirationPicker.oneYear'), value: 365 },
      { label: t('aboutIdentity.expirationPicker.never'), value: null },
    ];

    alert(
      t('aboutIdentity.expirationPicker.title'),
      t('aboutIdentity.expirationPicker.message'),
      [
        ...options.map(option => ({
          text: option.label,
          onPress: () => handleExpirationChange(option.value),
        })),
        { text: t('common.cancel'), style: 'cancel' },
      ]
    );
  }, [handleExpirationChange, t]);

  // Self-custody features
  const selfCustodyItems = useMemo(() => [
    {
      id: 'private-key',
      icon: 'key-variant',
      iconColor: colors.iconSuccess,
      title: t('aboutIdentity.items.privateKeyTitle'),
      subtitle: t('aboutIdentity.items.privateKeySubtitle'),
    },
    {
      id: 'no-password',
      icon: 'lock-off-outline',
      iconColor: colors.iconInfo,
      title: t('aboutIdentity.items.noPasswordTitle'),
      subtitle: t('aboutIdentity.items.noPasswordSubtitle'),
    },
    {
      id: 'recovery',
      icon: 'text-box-outline',
      iconColor: colors.iconWarning,
      title: t('aboutIdentity.items.recoveryTitle'),
      subtitle: t('aboutIdentity.items.recoverySubtitle'),
    },
    {
      id: 'decentralized',
      icon: 'web',
      iconColor: colors.identityIconPublicKey,
      title: t('aboutIdentity.items.decentralizedTitle'),
      subtitle: t('aboutIdentity.items.decentralizedSubtitle'),
    },
  ], [colors.iconSuccess, colors.iconInfo, colors.iconWarning, colors.identityIconPublicKey, t]);


  if (oxyLoading || loading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>{t('aboutIdentity.loading')}</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <ScreenHeader
            title={t('aboutIdentity.title')}
            subtitle={t('aboutIdentity.subtitle')}
          />

          {/* ID Card */}
          <Section title={t('aboutIdentity.idCard')}>
            <View style={styles.idCardContainer}>
              <IdentityCard
                displayName={displayName}
                username={user?.username}
                avatarUrl={avatarUrl}
                accountCreated={user?.createdAt}
                publicKey={publicKey || undefined}
                qrPayload={qrPayload}
                qrCaption={t('civic.id.qrCaption')}
              />
            </View>
            {publicKey && (
              <Button
                variant="secondary"
                onPress={handleCopyPublicKey}
                style={styles.copyPublicKeyButton}
              >
                {t('aboutIdentity.copyPublicKey')}
              </Button>
            )}
          </Section>

          {/* Important Notice */}
          <ImportantBanner>
            {t('aboutIdentity.importantNotice')}
          </ImportantBanner>

          {/* Self-Custody Identity */}
          <Section title={t('aboutIdentity.selfCustodyTitle')}>
            <ThemedText style={styles.sectionDescription}>
              {t('aboutIdentity.selfCustodyDescription')}
            </ThemedText>
            <AccountCard>
              <GroupedSection items={selfCustodyItems} />
            </AccountCard>
          </Section>

          {/* Account Settings */}
          <Section title={t('aboutIdentity.accountSettings')}>
            <ThemedText style={styles.sectionDescription}>
              {t('aboutIdentity.accountSettingsDescription')}
            </ThemedText>
            <AccountCard>
              <GroupedSection
                items={[
                  {
                    id: 'account-expiration',
                    icon: 'clock-outline',
                    iconColor: colors.tint,
                    title: t('aboutIdentity.accountExpiration'),
                    subtitle: formatExpirationSetting(currentExpirationDays),
                    onPress: isSavingExpiration ? undefined : showExpirationPicker,
                    showChevron: !isSavingExpiration,
                    disabled: isSavingExpiration,
                    customContent: isSavingExpiration ? (
                      <ActivityIndicator size="small" color={colors.tint} />
                    ) : undefined,
                  },
                ]}
              />
            </AccountCard>
          </Section>
        </View>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  idCardContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'stretch',
  } as const,
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    opacity: 0.7,
  },
  copyPublicKeyButton: {
    marginTop: 16,
  },
  sectionDescription: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 12,
    lineHeight: 20,
  },
});
