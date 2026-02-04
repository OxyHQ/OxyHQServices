/**
 * Settings content — renders setting sections.
 *
 * When `section` is provided, shows only that section (desktop detail pane).
 * When `section` is undefined, shows all sections in a scroll view (mobile full page).
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { ArrowLeft01Icon, Moon01Icon, Sun01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy, toast } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useSettings, useUpdateSettings } from '@/hooks/queries/useSettings';
import { useQuota } from '@/hooks/queries/useQuota';
import { useLabels, useCreateLabel, useUpdateLabel, useDeleteLabel } from '@/hooks/queries/useLabels';
import { useThemeContext } from '@/contexts/theme-context';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

interface SettingsPageProps {
  /** Which section to display. If undefined, shows all sections (mobile). */
  section?: string;
}

export function SettingsPage({ section }: SettingsPageProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { user } = useOxy();
  const { toggleColorScheme } = useThemeContext();
  const isDesktop = Platform.OS === 'web' && width >= 900;

  const { data: settingsData } = useSettings();
  const { data: quota } = useQuota();
  const { data: labels = [] } = useLabels();
  const updateSettings = useUpdateSettings();
  const createLabel = useCreateLabel();
  const updateLabelMutation = useUpdateLabel();
  const deleteLabel = useDeleteLabel();

  const [signature, setSignature] = useState('');
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoReplySubject, setAutoReplySubject] = useState('');
  const [autoReplyBody, setAutoReplyBody] = useState('');
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#4285f4');
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelName, setEditingLabelName] = useState('');
  const initialized = useRef(false);

  const LABEL_COLORS = [
    '#4285f4', '#ea4335', '#fbbc04', '#34a853',
    '#ff6d01', '#46bdc6', '#7b1fa2', '#c2185b',
    '#795548', '#607d8b',
  ];

  // Sync local form state from query data (once)
  useEffect(() => {
    if (settingsData && !initialized.current) {
      initialized.current = true;
      setSignature(settingsData.signature);
      setAutoReplyEnabled(settingsData.autoReply.enabled);
      setAutoReplySubject(settingsData.autoReply.subject ?? '');
      setAutoReplyBody(settingsData.autoReply.body ?? '');
    }
  }, [settingsData]);

  const saving = updateSettings.isPending;

  const handleSave = useCallback(() => {
    updateSettings.mutate(
      {
        signature,
        autoReply: {
          enabled: autoReplyEnabled,
          subject: autoReplySubject,
          body: autoReplyBody,
        },
      },
      {
        onSuccess: () => toast.success('Settings updated.'),
        onError: (err: any) => toast.error(err.message || 'Failed to save settings.'),
      },
    );
  }, [signature, autoReplyEnabled, autoReplySubject, autoReplyBody, updateSettings]);

  const emailAddress = user?.username ? `${user.username}@oxy.so` : '';

  const handleCreateLabel = useCallback(() => {
    if (!newLabelName.trim()) return;
    createLabel.mutate(
      { name: newLabelName.trim(), color: newLabelColor },
      {
        onSuccess: () => {
          setNewLabelName('');
          setNewLabelColor('#4285f4');
          toast.success('Label created.');
        },
        onError: (err: any) => toast.error(err.message || 'Failed to create label.'),
      },
    );
  }, [newLabelName, newLabelColor, createLabel]);

  const handleDeleteLabel = useCallback((labelId: string) => {
    deleteLabel.mutate(labelId, {
      onSuccess: () => toast.success('Label deleted.'),
      onError: (err: any) => toast.error(err.message || 'Failed to delete label.'),
    });
  }, [deleteLabel]);

  const handleUpdateLabel = useCallback((labelId: string) => {
    if (!editingLabelName.trim()) return;
    updateLabelMutation.mutate(
      { labelId, updates: { name: editingLabelName.trim() } },
      {
        onSuccess: () => {
          setEditingLabelId(null);
          setEditingLabelName('');
        },
        onError: (err: any) => toast.error(err.message || 'Failed to update label.'),
      },
    );
  }, [editingLabelName, updateLabelMutation]);

  const handleUpdateLabelColor = useCallback((labelId: string, color: string) => {
    updateLabelMutation.mutate(
      { labelId, updates: { color } },
      { onError: (err: any) => toast.error(err.message || 'Failed to update label.') },
    );
  }, [updateLabelMutation]);

  const showAll = !section;
  const showGeneral = showAll || section === 'general';
  const showSignature = showAll || section === 'signature';
  const showVacation = showAll || section === 'vacation';
  const showLabels = showAll || section === 'labels';
  const showAppearance = showAll || section === 'appearance';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }, !isDesktop && { paddingTop: insets.top }]}>
      {/* Header — only on mobile (desktop has nav sidebar) */}
      {!isDesktop && (
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={ArrowLeft01Icon as unknown as IconSvgElement} size={24} color={colors.icon} />
            ) : (
              <MaterialCommunityIcons name="arrow-left" size={24} color={colors.icon} />
            )}
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
      )}

      {/* Desktop save button */}
      {isDesktop && (
        <View style={[styles.desktopHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.sectionPageTitle, { color: colors.text }]}>
            {section === 'general' ? 'General' : section === 'signature' ? 'Signature' : section === 'vacation' ? 'Vacation Responder' : section === 'labels' ? 'Labels' : section === 'appearance' ? 'Appearance' : 'Settings'}
          </Text>
          <View style={styles.headerSpacer} />
          <TouchableOpacity
            onPress={handleSave}
            style={[styles.saveButton, { backgroundColor: colors.primary, opacity: saving ? 0.5 : 1 }]}
            disabled={saving}
          >
            <Text style={styles.saveButtonText}>Save</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {/* Account / General */}
        {showGeneral && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>Account</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <View style={styles.cardRow}>
                <Text style={[styles.cardLabel, { color: colors.secondaryText }]}>Email</Text>
                <Text style={[styles.cardValue, { color: colors.text }]}>{emailAddress}</Text>
              </View>
            </View>

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
                    <Text style={[styles.cardLabel, { color: colors.secondaryText }]}>Usage</Text>
                    <Text style={[styles.cardValue, { color: colors.text }]}>
                      {quota.percentage}%
                    </Text>
                  </View>
                </View>
              </>
            )}
          </>
        )}

        {/* Signature */}
        {showSignature && (
          <>
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
          </>
        )}

        {/* Vacation Responder */}
        {showVacation && (
          <>
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
          </>
        )}

        {/* Labels */}
        {showLabels && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>Labels</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              {/* Existing labels */}
              {labels.map((lbl) => (
                <View key={lbl._id} style={styles.labelRow}>
                  {editingLabelId === lbl._id ? (
                    <>
                      <TextInput
                        style={[styles.labelEditInput, { color: colors.text, borderColor: colors.border }]}
                        value={editingLabelName}
                        onChangeText={setEditingLabelName}
                        autoFocus
                        onSubmitEditing={() => handleUpdateLabel(lbl._id)}
                        returnKeyType="done"
                      />
                      <TouchableOpacity onPress={() => handleUpdateLabel(lbl._id)}>
                        <MaterialCommunityIcons name="check" size={20} color={colors.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingLabelId(null)}>
                        <MaterialCommunityIcons name="close" size={20} color={colors.icon} />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <View style={[styles.labelColorDot, { backgroundColor: lbl.color }]} />
                      <Text style={[styles.labelName, { color: colors.text }]}>{lbl.name}</Text>
                      <View style={styles.labelActions}>
                        <TouchableOpacity
                          onPress={() => {
                            setEditingLabelId(lbl._id);
                            setEditingLabelName(lbl.name);
                          }}
                        >
                          <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.icon} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDeleteLabel(lbl._id)}>
                          <MaterialCommunityIcons name="delete-outline" size={18} color={colors.icon} />
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              ))}
              {labels.length === 0 && (
                <Text style={[styles.emptyLabel, { color: colors.secondaryText }]}>No labels yet</Text>
              )}

              {/* Create new label */}
              <View style={[styles.newLabelRow, { borderTopColor: colors.border }]}>
                <View style={styles.colorPalette}>
                  {LABEL_COLORS.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: c },
                        newLabelColor === c && styles.colorSwatchActive,
                      ]}
                      onPress={() => setNewLabelColor(c)}
                    />
                  ))}
                </View>
                <View style={styles.newLabelInputRow}>
                  <TextInput
                    style={[styles.newLabelInput, { color: colors.text, borderColor: colors.border }]}
                    value={newLabelName}
                    onChangeText={setNewLabelName}
                    placeholder="New label name"
                    placeholderTextColor={colors.searchPlaceholder}
                    onSubmitEditing={handleCreateLabel}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    style={[styles.addLabelButton, { backgroundColor: colors.primary, opacity: newLabelName.trim() ? 1 : 0.4 }]}
                    onPress={handleCreateLabel}
                    disabled={!newLabelName.trim()}
                  >
                    <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
                    <Text style={styles.addLabelText}>Add</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </>
        )}

        {/* Appearance */}
        {showAppearance && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>Appearance</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <TouchableOpacity style={styles.switchRow} onPress={toggleColorScheme}>
                <Text style={[styles.cardLabel, { color: colors.text }]}>Dark mode</Text>
                {Platform.OS === 'web' ? (
                  <HugeiconsIcon
                    icon={(colorScheme === 'dark' ? Moon01Icon : Sun01Icon) as unknown as IconSvgElement}
                    size={22}
                    color={colors.icon}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name={colorScheme === 'dark' ? 'weather-night' : 'weather-sunny'}
                    size={22}
                    color={colors.icon}
                  />
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
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
  desktopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '500',
    marginLeft: 4,
  },
  sectionPageTitle: {
    fontSize: 18,
    fontWeight: '600',
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  labelColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  labelName: {
    fontSize: 14,
    flex: 1,
  },
  labelActions: {
    flexDirection: 'row',
    gap: 12,
  },
  labelEditInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 14,
  },
  emptyLabel: {
    fontSize: 13,
    paddingVertical: 8,
  },
  newLabelRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    gap: 8,
  },
  colorPalette: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  colorSwatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  colorSwatchActive: {
    borderWidth: 2,
    borderColor: '#000',
  },
  newLabelInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  newLabelInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  addLabelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addLabelText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
