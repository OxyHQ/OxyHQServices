/**
 * Email settings screen — signature, auto-reply, and quota info.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { createEmailApi, type QuotaUsage } from '@/services/emailApi';
import { useThemeContext } from '@/contexts/theme-context';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { user, oxyServices } = useOxy();
  const emailApi = useMemo(() => createEmailApi(oxyServices.httpService), [oxyServices]);
  const { toggleColorScheme } = useThemeContext();

  const [quota, setQuota] = useState<QuotaUsage | null>(null);
  const [signature, setSignature] = useState('');
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoReplySubject, setAutoReplySubject] = useState('');
  const [autoReplyBody, setAutoReplyBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, q] = await Promise.all([emailApi.getSettings(), emailApi.getQuota()]);
        setQuota(q);
        setSignature(s.signature);
        setAutoReplyEnabled(s.autoReply.enabled);
        setAutoReplySubject(s.autoReply.subject);
        setAutoReplyBody(s.autoReply.body);
      } catch {}
    };
    load();
  }, [emailApi]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await emailApi.updateSettings({
        signature,
        autoReply: {
          enabled: autoReplyEnabled,
          subject: autoReplySubject,
          body: autoReplyBody,
        },
      });
      Alert.alert('Saved', 'Settings updated.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }, [signature, autoReplyEnabled, autoReplySubject, autoReplyBody, emailApi]);

  const emailAddress = user?.username ? `${user.username}@oxy.so` : '';

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.icon} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
        <View style={styles.headerSpacer} />
        <TouchableOpacity
          onPress={handleSave}
          style={[styles.saveButton, { backgroundColor: colors.primary, opacity: saving ? 0.5 : 1 }]}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {/* Account */}
        <Text style={[styles.sectionTitle, { color: colors.primary }]}>Account</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.cardRow}>
            <Text style={[styles.cardLabel, { color: colors.secondaryText }]}>Email</Text>
            <Text style={[styles.cardValue, { color: colors.text }]}>{emailAddress}</Text>
          </View>
        </View>

        {/* Quota */}
        {quota && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>Storage</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <View style={styles.cardRow}>
                <Text style={[styles.cardLabel, { color: colors.secondaryText }]}>Used</Text>
                <Text style={[styles.cardValue, { color: colors.text }]}>
                  {formatBytes(quota.used)} of {formatBytes(quota.limit)}
                </Text>
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: quota.percentage > 90 ? colors.error : colors.primary,
                      width: `${Math.min(quota.percentage, 100)}%`,
                    },
                  ]}
                />
              </View>
              <View style={styles.cardRow}>
                <Text style={[styles.cardLabel, { color: colors.secondaryText }]}>Emails sent today</Text>
                <Text style={[styles.cardValue, { color: colors.text }]}>
                  {quota.dailySendCount} / {quota.dailySendLimit}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Signature */}
        <Text style={[styles.sectionTitle, { color: colors.primary }]}>Signature</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <TextInput
            style={[styles.textArea, { color: colors.text, borderColor: colors.border }]}
            value={signature}
            onChangeText={setSignature}
            placeholder="Your email signature"
            placeholderTextColor={colors.searchPlaceholder}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Auto-reply */}
        <Text style={[styles.sectionTitle, { color: colors.primary }]}>Vacation Responder</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.switchRow}>
            <Text style={[styles.cardLabel, { color: colors.text }]}>Vacation responder on</Text>
            <Switch
              value={autoReplyEnabled}
              onValueChange={setAutoReplyEnabled}
              trackColor={{ false: colors.border, true: colors.primaryContainer }}
              thumbColor={autoReplyEnabled ? colors.primary : colors.icon}
            />
          </View>
          {autoReplyEnabled && (
            <>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                value={autoReplySubject}
                onChangeText={setAutoReplySubject}
                placeholder="Subject"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <TextInput
                style={[styles.textArea, { color: colors.text, borderColor: colors.border }]}
                value={autoReplyBody}
                onChangeText={setAutoReplyBody}
                placeholder="Message"
                placeholderTextColor={colors.searchPlaceholder}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </>
          )}
        </View>

        {/* Theme */}
        <Text style={[styles.sectionTitle, { color: colors.primary }]}>Appearance</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <TouchableOpacity style={styles.switchRow} onPress={toggleColorScheme}>
            <Text style={[styles.cardLabel, { color: colors.text }]}>Dark mode</Text>
            <MaterialCommunityIcons
              name={colorScheme === 'dark' ? 'weather-night' : 'weather-sunny'}
              size={22}
              color={colors.icon}
            />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '500',
    marginLeft: 4,
  },
  headerSpacer: {
    flex: 1,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  saveButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
    paddingBottom: 40,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLabel: {
    fontSize: 14,
  },
  cardValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 80,
  },
});
