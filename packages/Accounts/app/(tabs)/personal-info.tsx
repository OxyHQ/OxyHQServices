import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard } from '@/components/ui';

export default function PersonalInfoScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const personalInfoItems = useMemo(() => [
    {
      id: 'name',
      icon: 'account-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Full name',
      subtitle: 'Nate Isern Alvarez',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Edit</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'email',
      icon: 'email-outline',
      iconColor: colors.sidebarIconSecurity,
      title: 'Email',
      subtitle: 'hello@oxy.so',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Update</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'phone',
      icon: 'phone-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Phone number',
      subtitle: '+1 (555) 123-4567',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Edit</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'address',
      icon: 'map-marker-outline',
      iconColor: colors.sidebarIconData,
      title: 'Address',
      subtitle: '123 Main St, City, State 12345',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Edit</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'birthday',
      icon: 'cake-outline',
      iconColor: colors.sidebarIconFamily,
      title: 'Birthday',
      subtitle: 'January 1, 1990',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Edit</Text>
        </TouchableOpacity>
      ),
    },
  ], [colors]);

  // Desktop: layout handles sidebar and ScrollView, we just return content
  if (isDesktop) {
    return (
      <>
        <View style={styles.headerSection}>
          <ThemedText style={styles.title}>Personal info</ThemedText>
          <ThemedText style={styles.subtitle}>Manage your personal information and profile details.</ThemedText>
        </View>
        <AccountCard>
          <GroupedSection items={personalInfoItems} />
        </AccountCard>
      </>
    );
  }

  // Mobile: need our own ScrollView
  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.mobileContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.mobileHeaderSection}>
        <ThemedText style={styles.mobileTitle}>Personal info</ThemedText>
        <ThemedText style={styles.mobileSubtitle}>Manage your personal information and profile details.</ThemedText>
      </View>
      <AccountCard>
        <GroupedSection items={personalInfoItems} />
      </AccountCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  headerSection: {
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.6,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  },
  mobileHeaderSection: {
    marginBottom: 20,
  },
  mobileTitle: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 6,
  },
  mobileSubtitle: {
    fontSize: 15,
    opacity: 0.6,
  },
});

