import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Screen, StackHeader, ImportantBanner } from '@/components/ui';
import { useTranslation } from '@/lib/i18n';
import { useRotateKeyFlow } from '@/contexts/rotate-key-flow-context';

/**
 * Key-rotation entry: choose how to prove control of the current key.
 *
 *  - Path A ("Rotate with this device"): sign the rotation with the on-device
 *    key. The default when the key is healthy.
 *  - Path B ("My device key is lost"): re-derive the current key from the entered
 *    recovery phrase — the way to replace the LAST remaining credential.
 */
export default function RotateKeyEntryScreen() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useTranslation();
  const { setProof, reset } = useRotateKeyFlow();

  const handleDevice = useCallback(() => {
    reset();
    setProof('device');
    router.push('/(tabs)/(settings)/rotate-key/recovery-phrase');
  }, [reset, setProof, router]);

  const handlePhrase = useCallback(() => {
    reset();
    setProof('phrase');
    router.push('/(tabs)/(settings)/rotate-key/current-phrase');
  }, [reset, setProof, router]);

  return (
    <Screen>
      <StackHeader
        title={t('rotateKey.title')}
        subtitle={t('rotateKey.subtitle')}
        onBack={() => router.back()}
        backAccessibilityLabel={t('common.back')}
      />

      <ImportantBanner title={t('rotateKey.warningTitle')} icon="alert-octagon">
        {t('rotateKey.warning')}
      </ImportantBanner>

      <View style={styles.options}>
        <PathOption
          icon="cellphone-key"
          title={t('rotateKey.pathDevice')}
          subtitle={t('rotateKey.pathDeviceSubtitle')}
          onPress={handleDevice}
          colors={colors}
        />
        <PathOption
          icon="key-remove"
          title={t('rotateKey.pathPhrase')}
          subtitle={t('rotateKey.pathPhraseSubtitle')}
          onPress={handlePhrase}
          colors={colors}
        />
      </View>
    </Screen>
  );
}

function PathOption({
  icon,
  title,
  subtitle,
  onPress,
  colors,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[styles.option, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={[styles.optionIcon, { backgroundColor: `${colors.tint}1A` }]}>
        <MaterialCommunityIcons name={icon} size={24} color={colors.tint} />
      </View>
      <View style={styles.optionText}>
        <ThemedText style={[styles.optionTitle, { color: colors.text }]}>{title}</ThemedText>
        <ThemedText style={[styles.optionSubtitle, { color: colors.textSecondary }]}>
          {subtitle}
        </ThemedText>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  options: {
    gap: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderRadius: 16,
    borderCurve: 'continuous',
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  optionSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
});
