/**
 * Advanced subscreen — filters, templates, bundles, import.
 *
 * Power-user features that don't fit the standard mail/account/notification
 * buckets. Layout follows the Alia subsection pattern (small eyebrow header
 * + visual content block) rather than the iOS row-spam look.
 *
 * Subsections:
 *  1. Filters & rules — list with enable toggle + delete; a simple inline
 *     create form (field + condition + value + action).
 *  2. Templates — saved snippet bodies with inline edit + delete + create.
 *  3. Bundles — enable/disable + reorder auto-grouping bundles.
 *  4. Import — .eml file picker (web only).
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button } from '@oxyhq/bloom/button';
import { Switch } from '@oxyhq/bloom/switch';
import { Text } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';
import { Admonition } from '@oxyhq/bloom/admonition';
import { Dialog, useDialogControl, toast } from '@oxyhq/bloom';
import {
  Filter_Stroke2_Corner0_Rounded,
  PageText_Stroke2_Corner0_Rounded,
  ArrowOutOfBox_Stroke2_Corner0_Rounded,
  Trash_Stroke2_Corner0_Rounded,
  Pencil_Stroke2_Corner0_Rounded,
  PlusSmall_Stroke2_Corner0_Rounded,
  Loader_Stroke2_Corner0_Rounded,
  CircleCheck_Stroke2_Corner0_Rounded,
  Group3_Stroke2_Corner0_Rounded,
  ChevronTop_Stroke2_Corner0_Rounded,
  ChevronBottom_Stroke2_Corner0_Rounded,
} from '@oxyhq/bloom/icons';

import { useColors } from '@/constants/theme';
import { SectionHeader } from '@/components/settings/SectionHeader';
import { useFilters } from '@/hooks/queries/useFilters';
import {
  useCreateFilter,
  useUpdateFilter,
  useDeleteFilter,
} from '@/hooks/mutations/useFilterMutations';
import { useTemplates } from '@/hooks/queries/useTemplates';
import {
  useCreateTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
} from '@/hooks/mutations/useTemplateMutations';
import { useBundles } from '@/hooks/queries/useBundles';
import { useUpdateBundle, useReorderBundle } from '@/hooks/mutations/useBundleMutations';
import { useEmailStore } from '@/hooks/useEmail';
import type { EmailFilterCondition, EmailFilterAction } from '@/services/emailApi';

// ─── Filter form option maps ─────────────────────────────────────────

type FilterField = EmailFilterCondition['field'];
type FilterOperator = EmailFilterCondition['operator'];
type FilterActionType = 'archive' | 'mark-read' | 'star' | 'delete';

const FIELD_OPTIONS: { value: FilterField; label: string }[] = [
  { value: 'from', label: 'From' },
  { value: 'to', label: 'To' },
  { value: 'subject', label: 'Subject' },
  { value: 'has-attachment', label: 'Has attachment' },
  { value: 'size', label: 'Size' },
];

const TEXT_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'not-contains', label: "doesn't contain" },
  { value: 'starts-with', label: 'starts with' },
  { value: 'ends-with', label: 'ends with' },
];

const SIZE_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'greater-than', label: 'larger than (bytes)' },
  { value: 'less-than', label: 'smaller than (bytes)' },
];

const ACTION_OPTIONS: { value: FilterActionType; label: string }[] = [
  { value: 'archive', label: 'Archive' },
  { value: 'mark-read', label: 'Mark read' },
  { value: 'star', label: 'Star' },
  { value: 'delete', label: 'Delete' },
];

function operatorsForField(field: FilterField) {
  if (field === 'size') return SIZE_OPERATORS;
  if (field === 'has-attachment') return [];
  return TEXT_OPERATORS;
}

interface ChipGroupProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

function ChipGroup<T extends string>({ options, value, onChange }: ChipGroupProps<T>) {
  const colors = useColors();
  const theme = useTheme();
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.chip,
              {
                backgroundColor: active ? theme.colors.primary : theme.colors.background,
                borderColor: active ? theme.colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={[styles.chipText, { color: active ? '#FFFFFF' : colors.text }]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AdvancedSection() {
  const colors = useColors();
  const theme = useTheme();

  const { data: filters = [] } = useFilters();
  const createFilter = useCreateFilter();
  const updateFilter = useUpdateFilter();
  const deleteFilter = useDeleteFilter();

  const { data: templates = [] } = useTemplates();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();

  const { data: bundles = [] } = useBundles();
  const updateBundle = useUpdateBundle();
  const reorderBundle = useReorderBundle();

  const sortedBundles = useMemo(
    () => [...bundles].sort((a, b) => a.order - b.order),
    [bundles],
  );

  const api = useEmailStore((s) => s._api);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; total: number } | null>(null);

  // ─── Filter create form state ──────────────────────────────────────
  const [filterName, setFilterName] = useState('');
  const [filterField, setFilterField] = useState<FilterField>('from');
  const [filterOperator, setFilterOperator] = useState<FilterOperator>('contains');
  const [filterValue, setFilterValue] = useState('');
  const [filterAction, setFilterAction] = useState<FilterActionType>('archive');

  // ─── Template create / edit state ──────────────────────────────────
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');

  const filterDelete = useDialogControl();
  const templateDelete = useDialogControl();
  const [filterPendingDelete, setFilterPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [templatePendingDelete, setTemplatePendingDelete] = useState<{ id: string; name: string } | null>(null);

  const handleFieldChange = useCallback((field: FilterField) => {
    setFilterField(field);
    const ops = operatorsForField(field);
    setFilterOperator(ops[0]?.value ?? 'contains');
  }, []);

  const filterValid = useMemo(() => {
    if (!filterName.trim()) return false;
    if (filterField === 'has-attachment') return true;
    return filterValue.trim().length > 0;
  }, [filterName, filterField, filterValue]);

  const handleCreateFilter = useCallback(() => {
    if (!filterValid) return;
    const condition: EmailFilterCondition =
      filterField === 'has-attachment'
        ? { field: 'has-attachment', operator: 'equals', value: 'true' }
        : { field: filterField, operator: filterOperator, value: filterValue.trim() };
    const action: EmailFilterAction = { type: filterAction };
    createFilter.mutate(
      {
        name: filterName.trim(),
        conditions: [condition],
        actions: [action],
        matchAll: true,
        enabled: true,
      },
      {
        onSuccess: () => {
          setFilterName('');
          setFilterValue('');
          setFilterField('from');
          setFilterOperator('contains');
          setFilterAction('archive');
          toast.success('Filter created.');
        },
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : 'Failed to create filter.';
          toast.error(message);
        },
      },
    );
  }, [filterValid, filterField, filterOperator, filterValue, filterAction, filterName, createFilter]);

  const handleToggleFilter = useCallback(
    (filterId: string, enabled: boolean) => {
      updateFilter.mutate(
        { filterId, enabled },
        {
          onError: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Failed to update filter.';
            toast.error(message);
          },
        },
      );
    },
    [updateFilter],
  );

  const handleDeleteFilter = useCallback(() => {
    if (!filterPendingDelete) return;
    deleteFilter.mutate(filterPendingDelete.id, {
      onSuccess: () => {
        toast.success('Filter deleted.');
        setFilterPendingDelete(null);
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to delete filter.';
        toast.error(message);
      },
    });
  }, [filterPendingDelete, deleteFilter]);

  const resetTemplateForm = useCallback(() => {
    setEditingTemplateId(null);
    setTemplateName('');
    setTemplateSubject('');
    setTemplateBody('');
  }, []);

  const handleEditTemplate = useCallback(
    (id: string, name: string, subject: string, body: string) => {
      setEditingTemplateId(id);
      setTemplateName(name);
      setTemplateSubject(subject);
      setTemplateBody(body);
    },
    [],
  );

  const handleSubmitTemplate = useCallback(() => {
    const name = templateName.trim();
    const body = templateBody;
    const subject = templateSubject.trim();
    if (!name || !body.trim()) return;

    if (editingTemplateId) {
      updateTemplate.mutate(
        { templateId: editingTemplateId, name, subject, body },
        {
          onSuccess: () => {
            resetTemplateForm();
            toast.success('Template updated.');
          },
          onError: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Failed to update template.';
            toast.error(message);
          },
        },
      );
      return;
    }

    createTemplate.mutate(
      { name, subject: subject || undefined, body },
      {
        onSuccess: () => {
          resetTemplateForm();
          toast.success('Template created.');
        },
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : 'Failed to create template.';
          toast.error(message);
        },
      },
    );
  }, [templateName, templateBody, templateSubject, editingTemplateId, updateTemplate, createTemplate, resetTemplateForm]);

  const handleDeleteTemplate = useCallback(() => {
    if (!templatePendingDelete) return;
    deleteTemplate.mutate(templatePendingDelete.id, {
      onSuccess: () => {
        toast.success('Template deleted.');
        if (editingTemplateId === templatePendingDelete.id) resetTemplateForm();
        setTemplatePendingDelete(null);
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to delete template.';
        toast.error(message);
      },
    });
  }, [templatePendingDelete, deleteTemplate, editingTemplateId, resetTemplateForm]);

  const handleImportFiles = useCallback(async () => {
    if (!api || Platform.OS !== 'web') return;
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
        const message = err instanceof Error ? err.message : 'Import failed.';
        toast.error(message);
      } finally {
        setImporting(false);
      }
    };
    input.click();
  }, [api]);

  const inputStyle = {
    color: colors.text,
    backgroundColor: theme.colors.background,
    borderColor: colors.border,
  };

  const templateSubmitting = editingTemplateId ? updateTemplate.isPending : createTemplate.isPending;
  const showValueInput = filterField !== 'has-attachment';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      {/* Filters & rules */}
      <View style={styles.subsection}>
        <SectionHeader icon={Filter_Stroke2_Corner0_Rounded} title="Filters & rules" />
        {filters.length === 0 ? (
          <Admonition type="info">
            No filters yet. Filters automatically apply actions like archiving, starring, or marking read to incoming messages.
          </Admonition>
        ) : (
          <View style={[styles.itemList, { borderColor: colors.border }]}>
            {filters.map((f, idx) => (
              <View
                key={f._id}
                style={[
                  styles.itemRow,
                  idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
              >
                <View style={styles.itemMain}>
                  <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
                    {f.name}
                  </Text>
                  <Text style={[styles.itemSub, { color: colors.secondaryText }]} numberOfLines={1}>
                    {`${f.conditions.length} condition${f.conditions.length === 1 ? '' : 's'} · ${f.actions.length} action${f.actions.length === 1 ? '' : 's'}`}
                  </Text>
                </View>
                <Switch
                  value={f.enabled}
                  onValueChange={(v) => handleToggleFilter(f._id, v)}
                />
                <Pressable
                  onPress={() => {
                    setFilterPendingDelete({ id: f._id, name: f.name });
                    filterDelete.open();
                  }}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${f.name}`}
                >
                  <Trash_Stroke2_Corner0_Rounded size="sm" style={{ color: colors.error }} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Create filter */}
        <View style={styles.createBlock}>
          <TextInput
            value={filterName}
            onChangeText={setFilterName}
            placeholder="Filter name"
            placeholderTextColor={colors.secondaryText}
            style={[styles.input, inputStyle]}
          />
          <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>When a message&apos;s</Text>
          <ChipGroup options={FIELD_OPTIONS} value={filterField} onChange={handleFieldChange} />
          {showValueInput ? (
            <>
              <ChipGroup
                options={operatorsForField(filterField)}
                value={filterOperator}
                onChange={setFilterOperator}
              />
              <TextInput
                value={filterValue}
                onChangeText={setFilterValue}
                placeholder={filterField === 'size' ? 'Size in bytes' : 'Value'}
                placeholderTextColor={colors.secondaryText}
                keyboardType={filterField === 'size' ? 'numeric' : 'default'}
                autoCapitalize="none"
                style={[styles.input, inputStyle]}
              />
            </>
          ) : null}
          <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>then</Text>
          <ChipGroup options={ACTION_OPTIONS} value={filterAction} onChange={setFilterAction} />
          <Button
            onPress={handleCreateFilter}
            disabled={!filterValid || createFilter.isPending}
            icon={<PlusSmall_Stroke2_Corner0_Rounded size="sm" style={{ color: '#FFFFFF' }} />}
            iconPosition="left"
          >
            {createFilter.isPending ? 'Creating…' : 'Add filter'}
          </Button>
        </View>
      </View>

      {/* Templates */}
      <View style={styles.subsection}>
        <SectionHeader icon={PageText_Stroke2_Corner0_Rounded} title="Templates" />
        {templates.length === 0 ? null : (
          <View style={[styles.itemList, { borderColor: colors.border }]}>
            {templates.map((t, idx) => (
              <View
                key={t._id}
                style={[
                  styles.itemRow,
                  idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                  editingTemplateId === t._id && { backgroundColor: theme.colors.background },
                ]}
              >
                <View style={styles.itemMain}>
                  <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Text style={[styles.itemSub, { color: colors.secondaryText }]} numberOfLines={1}>
                    {t.subject ? `${t.subject} — ` : ''}{t.body.replace(/\n/g, ' ').slice(0, 60)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleEditTemplate(t._id, t.name, t.subject, t.body)}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${t.name}`}
                >
                  <Pencil_Stroke2_Corner0_Rounded size="sm" style={{ color: colors.icon }} />
                </Pressable>
                <Pressable
                  onPress={() => {
                    setTemplatePendingDelete({ id: t._id, name: t.name });
                    templateDelete.open();
                  }}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${t.name}`}
                >
                  <Trash_Stroke2_Corner0_Rounded size="sm" style={{ color: colors.error }} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.createBlock}>
          {editingTemplateId ? (
            <Text style={[styles.fieldLabel, { color: theme.colors.primary }]}>Editing template</Text>
          ) : null}
          <TextInput
            value={templateName}
            onChangeText={setTemplateName}
            placeholder="Template name"
            placeholderTextColor={colors.secondaryText}
            style={[styles.input, inputStyle]}
          />
          <TextInput
            value={templateSubject}
            onChangeText={setTemplateSubject}
            placeholder="Subject (optional)"
            placeholderTextColor={colors.secondaryText}
            style={[styles.input, inputStyle]}
          />
          <TextInput
            value={templateBody}
            onChangeText={setTemplateBody}
            placeholder="Template body"
            placeholderTextColor={colors.secondaryText}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            style={[styles.textArea, inputStyle]}
          />
          <View style={styles.buttonRow}>
            <Button
              onPress={handleSubmitTemplate}
              disabled={!templateName.trim() || !templateBody.trim() || templateSubmitting}
              icon={
                editingTemplateId ? (
                  <CircleCheck_Stroke2_Corner0_Rounded size="sm" style={{ color: '#FFFFFF' }} />
                ) : (
                  <PlusSmall_Stroke2_Corner0_Rounded size="sm" style={{ color: '#FFFFFF' }} />
                )
              }
              iconPosition="left"
            >
              {templateSubmitting
                ? editingTemplateId
                  ? 'Saving…'
                  : 'Creating…'
                : editingTemplateId
                  ? 'Save changes'
                  : 'Add template'}
            </Button>
            {editingTemplateId ? (
              <Button variant="text" onPress={resetTemplateForm}>
                Cancel
              </Button>
            ) : null}
          </View>
        </View>
      </View>

      {/* Bundles */}
      {sortedBundles.length > 0 ? (
        <View style={styles.subsection}>
          <SectionHeader icon={Group3_Stroke2_Corner0_Rounded} title="Bundles" />
          <View style={[styles.itemList, { borderColor: colors.border }]}>
            {sortedBundles.map((b, idx) => (
              <View
                key={b._id}
                style={[
                  styles.itemRow,
                  idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
              >
                <View style={[styles.bundleDot, { backgroundColor: b.color }]} />
                <View style={styles.itemMain}>
                  <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
                    {b.name}
                  </Text>
                </View>
                <Pressable
                  onPress={() => reorderBundle.mutate({ bundleId: b._id, direction: 'up' })}
                  disabled={idx === 0}
                  style={[styles.iconBtn, idx === 0 && styles.iconBtnDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${b.name} up`}
                >
                  <ChevronTop_Stroke2_Corner0_Rounded size="sm" style={{ color: colors.icon }} />
                </Pressable>
                <Pressable
                  onPress={() => reorderBundle.mutate({ bundleId: b._id, direction: 'down' })}
                  disabled={idx === sortedBundles.length - 1}
                  style={[styles.iconBtn, idx === sortedBundles.length - 1 && styles.iconBtnDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${b.name} down`}
                >
                  <ChevronBottom_Stroke2_Corner0_Rounded size="sm" style={{ color: colors.icon }} />
                </Pressable>
                <Switch
                  value={b.enabled}
                  onValueChange={(v) => updateBundle.mutate({ bundleId: b._id, enabled: v })}
                />
              </View>
            ))}
          </View>
          <Text style={[styles.footnote, { color: colors.secondaryText }]}>
            Bundles group related mail automatically. Toggle to enable and reorder how they stack in your inbox.
          </Text>
        </View>
      ) : null}

      {/* Import */}
      {Platform.OS === 'web' ? (
        <View style={styles.subsection}>
          <SectionHeader icon={ArrowOutOfBox_Stroke2_Corner0_Rounded} title="Import" />
          <Text style={[styles.body, { color: colors.secondaryText }]}>
            Import emails from .eml files. Imported messages land in your Inbox and can be moved or labelled like any other mail.
          </Text>
          <Button
            onPress={handleImportFiles}
            disabled={importing}
            icon={
              importing ? (
                <Loader_Stroke2_Corner0_Rounded size="sm" style={{ color: '#FFFFFF' }} />
              ) : (
                <ArrowOutOfBox_Stroke2_Corner0_Rounded size="sm" style={{ color: '#FFFFFF' }} />
              )
            }
            iconPosition="left"
          >
            {importing ? 'Importing…' : 'Import .eml files'}
          </Button>
          {importResult ? (
            <Admonition type="tip">
              {`Imported ${importResult.imported} of ${importResult.total} email${importResult.total === 1 ? '' : 's'}.`}
            </Admonition>
          ) : null}
        </View>
      ) : null}

      <Dialog
        control={filterDelete}
        title="Delete filter?"
        description={
          filterPendingDelete
            ? `"${filterPendingDelete.name}" will no longer run on new messages.`
            : ''
        }
        actions={[
          { label: 'Delete', color: 'destructive', onPress: handleDeleteFilter },
          { label: 'Cancel', color: 'cancel' },
        ]}
      />

      <Dialog
        control={templateDelete}
        title="Delete template?"
        description={
          templatePendingDelete
            ? `"${templatePendingDelete.name}" will be removed from your saved templates.`
            : ''
        }
        actions={[
          { label: 'Delete', color: 'destructive', onPress: handleDeleteTemplate },
          { label: 'Cancel', color: 'cancel' },
        ]}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 28,
  },
  subsection: {
    gap: 10,
  },
  itemList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  itemMain: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  itemSub: {
    fontSize: 13,
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnDisabled: {
    opacity: 0.35,
  },
  bundleDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  createBlock: {
    gap: 10,
    paddingTop: 6,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 96,
  },
  footnote: {
    fontSize: 12,
    paddingHorizontal: 2,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
});
