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
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { ArrowLeft01Icon, Moon01Icon, Sun01Icon, ComputerIcon } from '@hugeicons/core-free-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy, toast } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useSettings, useUpdateSettings } from '@/hooks/queries/useSettings';
import { useQuota } from '@/hooks/queries/useQuota';
import { useLabels, useCreateLabel, useUpdateLabel, useDeleteLabel } from '@/hooks/queries/useLabels';
import { useFilters } from '@/hooks/queries/useFilters';
import { useCreateFilter, useUpdateFilter, useDeleteFilter } from '@/hooks/mutations/useFilterMutations';
import { useTemplates } from '@/hooks/queries/useTemplates';
import { useCreateTemplate, useUpdateTemplate, useDeleteTemplate } from '@/hooks/mutations/useTemplateMutations';
import { useThemeContext } from '@/contexts/theme-context';
import { ContactsSection } from '@/components/ContactsSection';
import { useEmailStore } from '@/hooks/useEmail';

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
  const { themePreference, setThemePreference: setThemePref } = useThemeContext();
  const isDesktop = Platform.OS === 'web' && width >= 900;

  const { data: settingsData } = useSettings();
  const { data: quota } = useQuota();
  const { data: labels = [] } = useLabels();
  const updateSettings = useUpdateSettings();
  const createLabel = useCreateLabel();
  const updateLabelMutation = useUpdateLabel();
  const deleteLabel = useDeleteLabel();
  const { data: templates = [] } = useTemplates();
  const createTemplate = useCreateTemplate();
  const updateTemplateMutation = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const { data: filters = [] } = useFilters();
  const createFilter = useCreateFilter();
  const updateFilterMutation = useUpdateFilter();
  const deleteFilter = useDeleteFilter();

  const [signature, setSignature] = useState('');
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoReplySubject, setAutoReplySubject] = useState('');
  const [autoReplyBody, setAutoReplyBody] = useState('');
  const [autoForwardTo, setAutoForwardTo] = useState('');
  const [autoForwardKeepCopy, setAutoForwardKeepCopy] = useState(true);  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#4285f4');
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelName, setEditingLabelName] = useState('');
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateSubject, setNewTemplateSubject] = useState('');
  const [newTemplateBody, setNewTemplateBody] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState('');
  const [editingTemplateSubject, setEditingTemplateSubject] = useState('');
  const [editingTemplateBody, setEditingTemplateBody] = useState('');
  // Filter state
  const [editingFilterId, setEditingFilterId] = useState<string | null>(null);
  const [filterFormVisible, setFilterFormVisible] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [filterMatchAll, setFilterMatchAll] = useState(true);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [filterConditions, setFilterConditions] = useState<Array<{ field: string; operator: string; value: string }>>([
    { field: 'from', operator: 'contains', value: '' },
  ]);
  const [filterActions, setFilterActions] = useState<Array<{ type: string; value?: string }>>([
    { type: 'label', value: '' },
  ]);
  const initialized = useRef(false);

  // Import/Export state
  const api = useEmailStore((s) => s._api);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; total: number } | null>(null);

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
      setAutoForwardTo(settingsData.autoForwardTo ?? '');
      setAutoForwardKeepCopy(settingsData.autoForwardKeepCopy ?? true);
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
        autoForwardTo,
        autoForwardKeepCopy,
      },
      {
        onSuccess: () => toast.success('Settings updated.'),
        onError: (err: any) => toast.error(err.message || 'Failed to save settings.'),
      },
    );
  }, [signature, autoReplyEnabled, autoReplySubject, autoReplyBody, autoForwardTo, autoForwardKeepCopy, updateSettings]);

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

  const handleCreateTemplate = useCallback(() => {
    if (!newTemplateName.trim() || !newTemplateBody.trim()) return;
    createTemplate.mutate(
      { name: newTemplateName.trim(), subject: newTemplateSubject.trim() || undefined, body: newTemplateBody },
      {
        onSuccess: () => {
          setNewTemplateName('');
          setNewTemplateSubject('');
          setNewTemplateBody('');
          toast.success('Template created.');
        },
        onError: (err: any) => toast.error(err.message || 'Failed to create template.'),
      },
    );
  }, [newTemplateName, newTemplateSubject, newTemplateBody, createTemplate]);

  const handleUpdateTemplate = useCallback((templateId: string) => {
    if (!editingTemplateName.trim() || !editingTemplateBody.trim()) return;
    updateTemplateMutation.mutate(
      { templateId, name: editingTemplateName.trim(), subject: editingTemplateSubject, body: editingTemplateBody },
      {
        onSuccess: () => {
          setEditingTemplateId(null);
          setEditingTemplateName('');
          setEditingTemplateSubject('');
          setEditingTemplateBody('');
          toast.success('Template updated.');
        },
        onError: (err: any) => toast.error(err.message || 'Failed to update template.'),
      },
    );
  }, [editingTemplateName, editingTemplateSubject, editingTemplateBody, updateTemplateMutation]);

  const handleDeleteTemplate = useCallback((templateId: string) => {
    deleteTemplate.mutate(templateId, {
      onSuccess: () => toast.success('Template deleted.'),
      onError: (err: any) => toast.error(err.message || 'Failed to delete template.'),
    });
  }, [deleteTemplate]);

  // ─── Filter Handlers ──────────────────────────────────────────────

  const CONDITION_FIELDS = [
    { value: 'from', label: 'From' },
    { value: 'to', label: 'To' },
    { value: 'subject', label: 'Subject' },
    { value: 'has-attachment', label: 'Has attachment' },
    { value: 'size', label: 'Size (bytes)' },
  ];

  const CONDITION_OPERATORS: Record<string, Array<{ value: string; label: string }>> = {
    from: [
      { value: 'contains', label: 'contains' },
      { value: 'equals', label: 'equals' },
      { value: 'not-contains', label: 'does not contain' },
      { value: 'starts-with', label: 'starts with' },
      { value: 'ends-with', label: 'ends with' },
    ],
    to: [
      { value: 'contains', label: 'contains' },
      { value: 'equals', label: 'equals' },
      { value: 'not-contains', label: 'does not contain' },
    ],
    subject: [
      { value: 'contains', label: 'contains' },
      { value: 'equals', label: 'equals' },
      { value: 'not-contains', label: 'does not contain' },
      { value: 'starts-with', label: 'starts with' },
      { value: 'ends-with', label: 'ends with' },
    ],
    'has-attachment': [
      { value: 'equals', label: 'equals' },
    ],
    size: [
      { value: 'greater-than', label: 'greater than' },
      { value: 'less-than', label: 'less than' },
      { value: 'equals', label: 'equals' },
    ],
  };

  const ACTION_TYPES = [
    { value: 'label', label: 'Add label' },
    { value: 'move', label: 'Move to mailbox' },
    { value: 'star', label: 'Star' },
    { value: 'mark-read', label: 'Mark as read' },
    { value: 'archive', label: 'Archive' },
    { value: 'delete', label: 'Move to trash' },
    { value: 'forward', label: 'Forward to' },
  ];

  const ACTIONS_NEEDING_VALUE = ['label', 'move', 'forward'];

  const resetFilterForm = useCallback(() => {
    setFilterName('');
    setFilterMatchAll(true);
    setFilterEnabled(true);
    setFilterConditions([{ field: 'from', operator: 'contains', value: '' }]);
    setFilterActions([{ type: 'label', value: '' }]);
    setEditingFilterId(null);
    setFilterFormVisible(false);
  }, []);

  const handleCreateOrUpdateFilter = useCallback(() => {
    if (!filterName.trim()) return;
    const validConditions = filterConditions.filter((c) => c.value.trim() || c.field === 'has-attachment');
    if (validConditions.length === 0) return;
    const validActions = filterActions.filter(
      (a) => !ACTIONS_NEEDING_VALUE.includes(a.type) || a.value?.trim(),
    );
    if (validActions.length === 0) return;

    const payload = {
      name: filterName.trim(),
      enabled: filterEnabled,
      conditions: validConditions as Array<{ field: string; operator: string; value: string }>,
      matchAll: filterMatchAll,
      actions: validActions as Array<{ type: string; value?: string }>,
    };

    if (editingFilterId) {
      updateFilterMutation.mutate(
        { filterId: editingFilterId, ...payload },
        {
          onSuccess: () => {
            resetFilterForm();
            toast.success('Filter updated.');
          },
          onError: (err: any) => toast.error(err.message || 'Failed to update filter.'),
        },
      );
    } else {
      createFilter.mutate(payload, {
        onSuccess: () => {
          resetFilterForm();
          toast.success('Filter created.');
        },
        onError: (err: any) => toast.error(err.message || 'Failed to create filter.'),
      });
    }
  }, [filterName, filterEnabled, filterConditions, filterMatchAll, filterActions, editingFilterId, createFilter, updateFilterMutation, resetFilterForm]);

  const handleEditFilter = useCallback((filter: typeof filters[number]) => {
    setEditingFilterId(filter._id);
    setFilterName(filter.name);
    setFilterMatchAll(filter.matchAll);
    setFilterEnabled(filter.enabled);
    setFilterConditions(filter.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value })));
    setFilterActions(filter.actions.map((a) => ({ type: a.type, value: a.value })));
    setFilterFormVisible(true);
  }, []);

  const handleDeleteFilter = useCallback((filterId: string) => {
    deleteFilter.mutate(filterId, {
      onSuccess: () => toast.success('Filter deleted.'),
      onError: (err: any) => toast.error(err.message || 'Failed to delete filter.'),
    });
  }, [deleteFilter]);

  const handleToggleFilterEnabled = useCallback((filterId: string, enabled: boolean) => {
    updateFilterMutation.mutate(
      { filterId, enabled },
      { onError: (err: any) => toast.error(err.message || 'Failed to update filter.') },
    );
  }, [updateFilterMutation]);

  const updateCondition = useCallback((index: number, key: string, value: string) => {
    setFilterConditions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      // Reset operator when field changes
      if (key === 'field') {
        const operators = CONDITION_OPERATORS[value] || CONDITION_OPERATORS.from;
        next[index].operator = operators[0].value;
        next[index].value = value === 'has-attachment' ? 'true' : '';
      }
      return next;
    });
  }, []);

  const updateAction = useCallback((index: number, key: string, value: string) => {
    setFilterActions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  }, []);

  const addCondition = useCallback(() => {
    setFilterConditions((prev) => [...prev, { field: 'from', operator: 'contains', value: '' }]);
  }, []);

  const removeCondition = useCallback((index: number) => {
    setFilterConditions((prev) => prev.length > 1 ? prev.filter((_, i) => i !== index) : prev);
  }, []);

  const addAction = useCallback(() => {
    setFilterActions((prev) => [...prev, { type: 'label', value: '' }]);
  }, []);

  const removeAction = useCallback((index: number) => {
    setFilterActions((prev) => prev.length > 1 ? prev.filter((_, i) => i !== index) : prev);
  }, []);

  const summarizeConditions = (conditions: Array<{ field: string; operator: string; value: string }>) =>
    conditions.map((c) => `${c.field} ${c.operator} "${c.value}"`).join(', ');

  const summarizeActions = (actions: Array<{ type: string; value?: string }>) =>
    actions.map((a) => a.value ? `${a.type}: ${a.value}` : a.type).join(', ');

  const handleImportFiles = useCallback(async () => {
    if (!api || Platform.OS !== 'web') return;

    // Create a file input element and trigger it
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.eml';
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;

      setImporting(true);
      setImportResult(null);
      try {
        const result = await api.importMessages(files);
        setImportResult(result);
        toast.success(`Imported ${result.imported} of ${result.total} email(s).`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Import failed';
        toast.error(message);
      } finally {
        setImporting(false);
      }
    };
    input.click();
  }, [api]);

  const showAll = !section;
  const showGeneral = showAll || section === 'general';
  const showSignature = showAll || section === 'signature';
  const showVacation = showAll || section === 'vacation';
  const showForwarding = showAll || section === 'forwarding';
  const showLabels = showAll || section === 'labels';
  const showContacts = showAll || section === 'contacts';
  const showFilters = showAll || section === 'filters';
  const showTemplates = showAll || section === 'templates';
  const showImportExport = showAll || section === 'import-export';
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
            {section === 'general' ? 'General' : section === 'signature' ? 'Signature' : section === 'vacation' ? 'Vacation Responder' : section === 'forwarding' ? 'Forwarding' : section === 'labels' ? 'Labels' : section === 'contacts' ? 'Contacts' : section === 'filters' ? 'Filters & Rules' : section === 'templates' ? 'Templates' : section === 'import-export' ? 'Import & Export' : section === 'appearance' ? 'Appearance' : 'Settings'}
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

        {/* Forwarding */}
        {showForwarding && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>Forwarding</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text style={[styles.cardLabel, { color: colors.secondaryText }]}>
                {autoForwardTo
                  ? `Forwarding all incoming email to ${autoForwardTo}`
                  : 'No forwarding configured'}
              </Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                value={autoForwardTo}
                onChangeText={setAutoForwardTo}
                placeholder="Forward all incoming email to"
                placeholderTextColor={colors.searchPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {autoForwardTo.trim().length > 0 && (
                <View style={styles.switchRow}>
                  <Text style={[styles.cardLabel, { color: colors.text }]}>Keep a copy in Inbox</Text>
                  <Switch
                    value={autoForwardKeepCopy}
                    onValueChange={setAutoForwardKeepCopy}
                    trackColor={{ false: colors.border, true: colors.primaryContainer }}
                    thumbColor={autoForwardKeepCopy ? colors.primary : colors.icon}
                  />
                </View>
              )}
              {autoForwardTo.trim().length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setAutoForwardTo('');
                    setAutoForwardKeepCopy(true);
                  }}
                  style={[styles.filterCancelButton, { borderColor: colors.border, alignSelf: 'flex-start' }]}
                >
                  <Text style={[styles.filterCancelText, { color: colors.text }]}>Remove forwarding</Text>
                </TouchableOpacity>
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

        {/* Contacts */}
        {showContacts && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>Contacts</Text>
            <ContactsSection />
          </>
        )}

        {/* Filters & Rules */}
        {showFilters && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>Filters & Rules</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              {/* Existing filters */}
              {filters.map((f) => (
                <View key={f._id} style={[styles.filterRow, { borderBottomColor: colors.border }]}>
                  <View style={styles.filterHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.filterName, { color: colors.text }]}>{f.name}</Text>
                      <Text style={[styles.filterSummary, { color: colors.secondaryText }]} numberOfLines={1}>
                        If {f.matchAll ? 'all' : 'any'}: {summarizeConditions(f.conditions)}
                      </Text>
                      <Text style={[styles.filterSummary, { color: colors.secondaryText }]} numberOfLines={1}>
                        Then: {summarizeActions(f.actions)}
                      </Text>
                    </View>
                    <View style={styles.filterHeaderActions}>
                      <Switch
                        value={f.enabled}
                        onValueChange={(val) => handleToggleFilterEnabled(f._id, val)}
                        trackColor={{ false: colors.border, true: colors.primaryContainer }}
                        thumbColor={f.enabled ? colors.primary : colors.icon}
                        style={styles.filterSwitch}
                      />
                      <TouchableOpacity onPress={() => handleEditFilter(f)}>
                        <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.icon} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDeleteFilter(f._id)}>
                        <MaterialCommunityIcons name="delete-outline" size={18} color={colors.icon} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}
              {filters.length === 0 && !filterFormVisible && (
                <Text style={[styles.emptyLabel, { color: colors.secondaryText }]}>No filters yet</Text>
              )}

              {/* Filter form (create / edit) */}
              {filterFormVisible ? (
                <View style={[styles.filterForm, { borderTopColor: colors.border }]}>
                  <TextInput
                    style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                    value={filterName}
                    onChangeText={setFilterName}
                    placeholder="Filter name"
                    placeholderTextColor={colors.searchPlaceholder}
                  />

                  {/* Match mode */}
                  <View style={styles.filterMatchRow}>
                    <Text style={[styles.cardLabel, { color: colors.text }]}>Match</Text>
                    <View style={styles.filterMatchToggle}>
                      <TouchableOpacity
                        style={[
                          styles.filterMatchOption,
                          filterMatchAll && { backgroundColor: colors.primary },
                        ]}
                        onPress={() => setFilterMatchAll(true)}
                      >
                        <Text style={[styles.filterMatchText, filterMatchAll && { color: '#FFFFFF' }]}>All</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.filterMatchOption,
                          !filterMatchAll && { backgroundColor: colors.primary },
                        ]}
                        onPress={() => setFilterMatchAll(false)}
                      >
                        <Text style={[styles.filterMatchText, !filterMatchAll && { color: '#FFFFFF' }]}>Any</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Conditions */}
                  <Text style={[styles.filterSubheading, { color: colors.secondaryText }]}>Conditions</Text>
                  {filterConditions.map((cond, idx) => (
                    <View key={`cond-${idx}`} style={styles.filterConditionRow}>
                      <View style={styles.filterDropdown}>
                        <TouchableOpacity
                          style={[styles.filterSelect, { borderColor: colors.border }]}
                          onPress={() => {
                            const fields = CONDITION_FIELDS.map((f) => f.value);
                            const currentIdx = fields.indexOf(cond.field);
                            const nextIdx = (currentIdx + 1) % fields.length;
                            updateCondition(idx, 'field', fields[nextIdx]);
                          }}
                        >
                          <Text style={[styles.filterSelectText, { color: colors.text }]}>
                            {CONDITION_FIELDS.find((f) => f.value === cond.field)?.label || cond.field}
                          </Text>
                          <MaterialCommunityIcons name="chevron-down" size={16} color={colors.icon} />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.filterDropdown}>
                        <TouchableOpacity
                          style={[styles.filterSelect, { borderColor: colors.border }]}
                          onPress={() => {
                            const operators = CONDITION_OPERATORS[cond.field] || CONDITION_OPERATORS.from;
                            const currentIdx = operators.findIndex((o) => o.value === cond.operator);
                            const nextIdx = (currentIdx + 1) % operators.length;
                            updateCondition(idx, 'operator', operators[nextIdx].value);
                          }}
                        >
                          <Text style={[styles.filterSelectText, { color: colors.text }]}>
                            {(CONDITION_OPERATORS[cond.field] || CONDITION_OPERATORS.from).find((o) => o.value === cond.operator)?.label || cond.operator}
                          </Text>
                          <MaterialCommunityIcons name="chevron-down" size={16} color={colors.icon} />
                        </TouchableOpacity>
                      </View>
                      {cond.field === 'has-attachment' ? (
                        <TouchableOpacity
                          style={[styles.filterSelect, { borderColor: colors.border, flex: 1 }]}
                          onPress={() => updateCondition(idx, 'value', cond.value === 'true' ? 'false' : 'true')}
                        >
                          <Text style={[styles.filterSelectText, { color: colors.text }]}>
                            {cond.value === 'true' ? 'Yes' : 'No'}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TextInput
                          style={[styles.filterConditionInput, { color: colors.text, borderColor: colors.border }]}
                          value={cond.value}
                          onChangeText={(v) => updateCondition(idx, 'value', v)}
                          placeholder="Value"
                          placeholderTextColor={colors.searchPlaceholder}
                        />
                      )}
                      {filterConditions.length > 1 && (
                        <TouchableOpacity onPress={() => removeCondition(idx)}>
                          <MaterialCommunityIcons name="close-circle-outline" size={20} color={colors.icon} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity onPress={addCondition} style={styles.filterAddRow}>
                    <MaterialCommunityIcons name="plus-circle-outline" size={18} color={colors.primary} />
                    <Text style={[styles.filterAddText, { color: colors.primary }]}>Add condition</Text>
                  </TouchableOpacity>

                  {/* Actions */}
                  <Text style={[styles.filterSubheading, { color: colors.secondaryText }]}>Actions</Text>
                  {filterActions.map((action, idx) => (
                    <View key={`act-${idx}`} style={styles.filterConditionRow}>
                      <View style={styles.filterDropdown}>
                        <TouchableOpacity
                          style={[styles.filterSelect, { borderColor: colors.border }]}
                          onPress={() => {
                            const types = ACTION_TYPES.map((t) => t.value);
                            const currentIdx = types.indexOf(action.type);
                            const nextIdx = (currentIdx + 1) % types.length;
                            updateAction(idx, 'type', types[nextIdx]);
                          }}
                        >
                          <Text style={[styles.filterSelectText, { color: colors.text }]}>
                            {ACTION_TYPES.find((t) => t.value === action.type)?.label || action.type}
                          </Text>
                          <MaterialCommunityIcons name="chevron-down" size={16} color={colors.icon} />
                        </TouchableOpacity>
                      </View>
                      {ACTIONS_NEEDING_VALUE.includes(action.type) && (
                        <TextInput
                          style={[styles.filterConditionInput, { color: colors.text, borderColor: colors.border }]}
                          value={action.value || ''}
                          onChangeText={(v) => updateAction(idx, 'value', v)}
                          placeholder={action.type === 'label' ? 'Label name' : action.type === 'move' ? 'Mailbox ID' : 'Email address'}
                          placeholderTextColor={colors.searchPlaceholder}
                        />
                      )}
                      {filterActions.length > 1 && (
                        <TouchableOpacity onPress={() => removeAction(idx)}>
                          <MaterialCommunityIcons name="close-circle-outline" size={20} color={colors.icon} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity onPress={addAction} style={styles.filterAddRow}>
                    <MaterialCommunityIcons name="plus-circle-outline" size={18} color={colors.primary} />
                    <Text style={[styles.filterAddText, { color: colors.primary }]}>Add action</Text>
                  </TouchableOpacity>

                  {/* Enable toggle */}
                  <View style={styles.switchRow}>
                    <Text style={[styles.cardLabel, { color: colors.text }]}>Enabled</Text>
                    <Switch
                      value={filterEnabled}
                      onValueChange={setFilterEnabled}
                      trackColor={{ false: colors.border, true: colors.primaryContainer }}
                      thumbColor={filterEnabled ? colors.primary : colors.icon}
                    />
                  </View>

                  {/* Save / Cancel */}
                  <View style={styles.filterFormButtons}>
                    <TouchableOpacity
                      style={[styles.addLabelButton, { backgroundColor: colors.primary, opacity: filterName.trim() ? 1 : 0.4 }]}
                      onPress={handleCreateOrUpdateFilter}
                      disabled={!filterName.trim()}
                    >
                      <MaterialCommunityIcons name="check" size={18} color="#FFFFFF" />
                      <Text style={styles.addLabelText}>{editingFilterId ? 'Update' : 'Create'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterCancelButton, { borderColor: colors.border }]}
                      onPress={resetFilterForm}
                    >
                      <Text style={[styles.filterCancelText, { color: colors.text }]}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={[styles.newLabelRow, { borderTopColor: colors.border }]}>
                  <TouchableOpacity
                    style={[styles.addLabelButton, { backgroundColor: colors.primary }]}
                    onPress={() => {
                      resetFilterForm();
                      setFilterFormVisible(true);
                    }}
                  >
                    <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
                    <Text style={styles.addLabelText}>Create filter</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </>
        )}

        {/* Templates */}
        {showTemplates && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>Templates</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              {/* Existing templates */}
              {templates.map((tpl) => (
                <View key={tpl._id} style={styles.templateRow}>
                  {editingTemplateId === tpl._id ? (
                    <View style={styles.templateEditForm}>
                      <TextInput
                        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                        value={editingTemplateName}
                        onChangeText={setEditingTemplateName}
                        placeholder="Template name"
                        placeholderTextColor={colors.searchPlaceholder}
                        autoFocus
                      />
                      <TextInput
                        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                        value={editingTemplateSubject}
                        onChangeText={setEditingTemplateSubject}
                        placeholder="Subject (optional)"
                        placeholderTextColor={colors.searchPlaceholder}
                      />
                      <TextInput
                        style={[styles.textArea, { color: colors.text, borderColor: colors.border }]}
                        value={editingTemplateBody}
                        onChangeText={setEditingTemplateBody}
                        placeholder="Template body"
                        placeholderTextColor={colors.searchPlaceholder}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                      />
                      <View style={styles.templateEditActions}>
                        <TouchableOpacity
                          style={[styles.addLabelButton, { backgroundColor: colors.primary, opacity: editingTemplateName.trim() && editingTemplateBody.trim() ? 1 : 0.4 }]}
                          onPress={() => handleUpdateTemplate(tpl._id)}
                          disabled={!editingTemplateName.trim() || !editingTemplateBody.trim()}
                        >
                          <MaterialCommunityIcons name="check" size={16} color="#FFFFFF" />
                          <Text style={styles.addLabelText}>Save</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.templateCancelButton, { borderColor: colors.border }]}
                          onPress={() => {
                            setEditingTemplateId(null);
                            setEditingTemplateName('');
                            setEditingTemplateSubject('');
                            setEditingTemplateBody('');
                          }}
                        >
                          <Text style={[styles.templateCancelText, { color: colors.text }]}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={styles.templateInfo}>
                        <Text style={[styles.templateName, { color: colors.text }]}>{tpl.name}</Text>
                        <Text style={[styles.templatePreview, { color: colors.secondaryText }]} numberOfLines={1}>
                          {tpl.subject ? `${tpl.subject} — ` : ''}{tpl.body.replace(/\n/g, ' ').slice(0, 80)}
                        </Text>
                      </View>
                      <View style={styles.labelActions}>
                        <TouchableOpacity
                          onPress={() => {
                            setEditingTemplateId(tpl._id);
                            setEditingTemplateName(tpl.name);
                            setEditingTemplateSubject(tpl.subject || '');
                            setEditingTemplateBody(tpl.body);
                          }}
                        >
                          <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.icon} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDeleteTemplate(tpl._id)}>
                          <MaterialCommunityIcons name="delete-outline" size={18} color={colors.icon} />
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              ))}
              {templates.length === 0 && (
                <Text style={[styles.emptyLabel, { color: colors.secondaryText }]}>No templates yet</Text>
              )}

              {/* Create new template */}
              <View style={[styles.newLabelRow, { borderTopColor: colors.border }]}>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                  value={newTemplateName}
                  onChangeText={setNewTemplateName}
                  placeholder="Template name"
                  placeholderTextColor={colors.searchPlaceholder}
                />
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                  value={newTemplateSubject}
                  onChangeText={setNewTemplateSubject}
                  placeholder="Subject (optional)"
                  placeholderTextColor={colors.searchPlaceholder}
                />
                <TextInput
                  style={[styles.textArea, { color: colors.text, borderColor: colors.border }]}
                  value={newTemplateBody}
                  onChangeText={setNewTemplateBody}
                  placeholder="Template body"
                  placeholderTextColor={colors.searchPlaceholder}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[styles.addLabelButton, { backgroundColor: colors.primary, opacity: newTemplateName.trim() && newTemplateBody.trim() ? 1 : 0.4 }]}
                  onPress={handleCreateTemplate}
                  disabled={!newTemplateName.trim() || !newTemplateBody.trim()}
                >
                  <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
                  <Text style={styles.addLabelText}>Create Template</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        {/* Import & Export */}
        {showImportExport && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>Import & Export</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text style={[styles.cardLabel, { color: colors.secondaryText }]}>
                Import emails from .eml files into your Inbox.
              </Text>
              <TouchableOpacity
                style={[
                  styles.addLabelButton,
                  { backgroundColor: colors.primary, opacity: importing ? 0.5 : 1 },
                ]}
                onPress={handleImportFiles}
                disabled={importing}
              >
                {importing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <MaterialCommunityIcons name="file-import-outline" size={18} color="#FFFFFF" />
                )}
                <Text style={styles.addLabelText}>
                  {importing ? 'Importing...' : 'Import .eml files'}
                </Text>
              </TouchableOpacity>
              {importResult && (
                <Text style={[styles.cardValue, { color: colors.text }]}>
                  Imported {importResult.imported} of {importResult.total} email(s)
                </Text>
              )}
              <View style={[styles.importExportDivider, { borderTopColor: colors.border }]} />
              <Text style={[styles.cardLabel, { color: colors.secondaryText }]}>
                To export a single email, open it and use the "Download .eml" option from the message actions menu.
              </Text>
            </View>
          </>
        )}

        {/* Appearance */}
        {showAppearance && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>Appearance</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text style={[styles.cardLabel, { color: colors.text, marginBottom: 8 }]}>Theme</Text>
              <View style={styles.themeModePicker}>
                {(['light', 'dark', 'system'] as const).map((mode) => {
                  const isActive = themePreference === mode;
                  return (
                    <TouchableOpacity
                      key={mode}
                      style={[
                        styles.themeModeOption,
                        { borderColor: isActive ? colors.primary : colors.border },
                        isActive && { backgroundColor: colors.primary + '18' },
                      ]}
                      onPress={() => setThemePref(mode)}
                      activeOpacity={0.7}
                    >
                      {Platform.OS === 'web' ? (
                        <HugeiconsIcon
                          icon={(mode === 'dark' ? Moon01Icon : mode === 'light' ? Sun01Icon : ComputerIcon) as unknown as IconSvgElement}
                          size={18}
                          color={isActive ? colors.primary : colors.icon}
                        />
                      ) : (
                        <MaterialCommunityIcons
                          name={mode === 'dark' ? 'weather-night' : mode === 'light' ? 'weather-sunny' : 'monitor'}
                          size={18}
                          color={isActive ? colors.primary : colors.icon}
                        />
                      )}
                      <Text
                        style={[
                          styles.themeModeLabel,
                          { color: isActive ? colors.primary : colors.text },
                        ]}
                      >
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
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
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  templateInfo: {
    flex: 1,
    gap: 2,
  },
  templateName: {
    fontSize: 14,
    fontWeight: '500',
  },
  templatePreview: {
    fontSize: 12,
  },
  templateEditForm: {
    flex: 1,
    gap: 8,
  },
  templateEditActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  templateCancelButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  templateCancelText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // ─── Filter styles ─────────────────────────────────────────────
  filterRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterName: {
    fontSize: 14,
    fontWeight: '500',
  },
  filterSummary: {
    fontSize: 12,
    marginTop: 2,
  },
  filterHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filterSwitch: {
    transform: [{ scale: 0.8 }],
  },
  filterForm: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    gap: 10,
  },
  filterMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterMatchToggle: {
    flexDirection: 'row',
    borderRadius: 6,
    overflow: 'hidden',
  },
  filterMatchOption: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  filterMatchText: {
    fontSize: 13,
    fontWeight: '600',
  },
  filterSubheading: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  filterConditionRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  filterDropdown: {
    minWidth: 100,
  },
  filterSelect: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  filterSelectText: {
    fontSize: 13,
  },
  filterConditionInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    minWidth: 100,
  },
  filterAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  filterAddText: {
    fontSize: 13,
    fontWeight: '500',
  },
  filterFormButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  filterCancelButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  filterCancelText: {
    fontSize: 13,
    fontWeight: '600',
  },
  importExportDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  themeModePicker: {
    flexDirection: 'row',
    gap: 8,
  },
  themeModeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  themeModeLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
});
