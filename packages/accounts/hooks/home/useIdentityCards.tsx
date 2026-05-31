import React, { useMemo } from 'react';
import { Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import { CircleIconBadge } from '@/components/ui';
import type { IdentityCard } from '@/components/identity-cards-section';
import type { HomeHandlers } from './useHomeHandlers';

/**
 * Builds the self-custody identity cards (self-custody + public key) on the
 * home screen. Native-only — returns an empty array on web, where the screen
 * shows an informational banner instead.
 *
 * Extracted verbatim from the screen's inline `useMemo`. A `.tsx` file because
 * each card embeds a custom badge icon.
 */
export function useIdentityCards(handleAboutIdentity: HomeHandlers['handleAboutIdentity']): IdentityCard[] {
  const colors = useColors();
  const { t } = useTranslation();

  return useMemo<IdentityCard[]>(() => {
    // Only show identity items on native platforms
    if (Platform.OS === 'web') {
      return [];
    }
    return [
      {
        id: 'self-custody',
        customIcon: (
          <CircleIconBadge backgroundColor={colors.identityIconSelfCustody}>
            <MaterialCommunityIcons name="shield-key" size={22} color={darkenColor(colors.identityIconSelfCustody)} />
          </CircleIconBadge>
        ),
        title: t('home.identity.selfCustody'),
        subtitle: t('home.identity.selfCustodySubtitle'),
        onPress: handleAboutIdentity,
        showChevron: true,
      },
      {
        id: 'public-key',
        customIcon: (
          <CircleIconBadge backgroundColor={colors.identityIconPublicKey}>
            <MaterialCommunityIcons name="key-variant" size={22} color={darkenColor(colors.identityIconPublicKey)} />
          </CircleIconBadge>
        ),
        title: t('home.identity.publicKey'),
        subtitle: t('home.identity.publicKeySubtitle'),
        onPress: handleAboutIdentity,
        showChevron: true,
      },
    ];
  }, [handleAboutIdentity, colors.identityIconSelfCustody, colors.identityIconPublicKey, t]);
}
