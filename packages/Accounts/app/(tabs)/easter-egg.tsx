import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';
import { useHapticPress } from '@/hooks/use-haptic-press';

export default function EasterEggScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const handlePressIn = useHapticPress();

  const handleBack = () => {
    router.back();
  };

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <MaterialCommunityIcons 
            name="egg-easter" 
            size={120} 
            color={colors.tint} 
            style={styles.icon}
          />
          <ThemedText style={[styles.title, { color: colors.text }]}>
            🎉 Easter Egg Found! 🎉
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: colors.secondaryText }]}>
            You discovered a hidden feature!
          </ThemedText>
          <ThemedText style={[styles.description, { color: colors.text }]}>
            Long press the logo to access this screen anytime.
          </ThemedText>
          
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: colors.tint }]}
            onPressIn={handlePressIn}
            onPress={handleBack}
            activeOpacity={0.7}
          >
            <ThemedText style={[styles.backButtonText, { color: '#FFFFFF' }]}>
              Go Back
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
    maxWidth: 400,
  },
  icon: {
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 24,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
    opacity: 0.7,
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 24,
    minWidth: 120,
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

