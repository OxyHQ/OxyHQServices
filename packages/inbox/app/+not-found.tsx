import React from 'react';
import { StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Link, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { H1, H4 } from '@oxyhq/bloom/typography';
import { useColors } from '@/constants/theme';
import { useTranslation } from '@/lib/i18n';

export default function NotFoundScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;
  const { t } = useTranslation();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {/*
       * This screen is outside the (drawer)/(tabs) tree, so NativeTabs'
       * SafeAreaView doesn't wrap it. We have to pad all four edges
       * ourselves — explicitly via react-native-safe-area-context (NOT the
       * react-native built-in, which on Android doesn't read the gesture-bar
       * inset). Otherwise the "Back to Inbox" link can slip under the home
       * indicator and the 404 sits in the status-bar area on landscape /
       * notch devices.
       */}
      <SafeAreaView
        edges={['top', 'bottom', 'left', 'right']}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <H1 style={[styles.code, { color: colors.border }]}>404</H1>
        <H4 style={[styles.title, { color: colors.text }]}>
          {t('notFound.title')}
        </H4>
        <Link
          href="/"
          style={[
            styles.link,
            {
              color: colors.primary,
              borderColor: colors.primary,
            },
            isDesktop && styles.linkDesktop,
          ]}
        >
          {t('notFound.back')}
        </Link>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  code: {
    fontSize: 120,
    fontWeight: '700',
    lineHeight: 130,
    letterSpacing: -2,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
    maxWidth: 400,
    lineHeight: 30,
  },
  link: {
    marginTop: 24,
    fontSize: 15,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  linkDesktop: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    fontSize: 16,
  },
});
