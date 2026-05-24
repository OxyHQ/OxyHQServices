/**
 * Advanced subscreen — filters, templates, import.
 *
 * Power-user features that don't fit the standard mail/account/notification
 * buckets. Layout follows the Alia subsection pattern (small eyebrow header
 * + visual content block) rather than the iOS row-spam look.
 *
 * Three subsections:
 *  1. Filters & rules — list of filters with enable toggle + delete; create
 *     opens a small inline form.
 *  2. Templates — saved snippet bodies for quick compose.
 *  3. Import — file picker on web (native is no-op for now).
 *
 * For deeper authoring (multi-condition filter builder, rich-text template
 * editor), this screen links to dedicated bottom sheets in future passes;
 * today it surfaces the essentials.
 */

import React, { useCallback, useState } from 'react';
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
import * as Prompt from '@oxyhq/bloom/prompt';
import { usePromptControl } from '@oxyhq/bloom/prompt';
import {
  Filter_Stroke2_Corner0_Rounded,
  PageText_Stroke2_Corner0_Rounded,
  ArrowOutOfBox_Stroke2_Corner0_Rounded,
  Trash_Stroke2_Corner0_Rounded,
  PlusSmall_Stroke2_Corner0_Rounded,
  Loader_Stroke2_Corner0_Rounded,
} from '@oxyhq/bloom/icons';
import { toast } from '@oxyhq/services';

import { useColors } from '@/constants/theme';
import { SectionHeader } from '@/components/settings/SectionHeader';
import { useFilters } from '@/hooks/queries/useFilters';
import {
  useUpdateFilter,
  useDeleteFilter,
} from '@/hooks/mutations/useFilterMutations';
import { useTemplates } from '@/hooks/queries/useTemplates';
import {
  useCreateTemplate,
  useDeleteTemplate,
} from '@/hooks/mutations/useTemplateMutations';
import { useEmailStore } from '@/hooks/useEmail';

export function AdvancedSection() {
  const colors = useColors();
  const theme = useTheme();

  const { data: filters = [] } = useFilters();
  const updateFilter = useUpdateFilter();
  const deleteFilter = useDeleteFilter();

  const { data: templates = [] } = useTemplates();
  const createTemplate = useCreateTemplate();
  const deleteTemplate = useDeleteTemplate();

  const api = useEmailStore((s) => s._api);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; total: number } | null>(null);

  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateSubject, setNewTemplateSubject] = useState('');
  const [newTemplateBody, setNewTemplateBody] = useState('');

  const filterDelete = usePromptControl();
  const templateDelete = usePromptControl();
  const [filterPendingDelete, setFilterPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [templatePendingDelete, setTemplatePendingDelete] = useState<{ id: string; name: string } | null>(null);

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

  const handleCreateTemplate = useCallback(() => {
    const name = newTemplateName.trim();
    const body = newTemplateBody;
    const subject = newTemplateSubject.trim();
    if (!name || !body.trim()) return;
    createTemplate.mutate(
      { name, subject: subject || undefined, body },
      {
        onSuccess: () => {
          setNewTemplateName('');
          setNewTemplateSubject('');
          setNewTemplateBody('');
          toast.success('Template created.');
        },
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : 'Failed to create template.';
          toast.error(message);
        },
      },
    );
  }, [newTemplateName, newTemplateSubject, newTemplateBody, createTemplate]);

  const handleDeleteTemplate = useCallback(() => {
    if (!templatePendingDelete) return;
    deleteTemplate.mutate(templatePendingDelete.id, {
      onSuccess: () => {
        toast.success('Template deleted.');
        setTemplatePendingDelete(null);
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to delete template.';
        toast.error(message);
      },
    });
  }, [templatePendingDelete, deleteTemplate]);

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
            No filters yet. Filters automatically apply actions like labelling, archiving, or forwarding to incoming messages.
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
                  <Trash_Stroke2_Corner0_Rounded
                    size="sm"
                    style={{ color: colors.error }}
                  />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <Text style={[styles.footnote, { color: colors.secondaryText }]}>
          Use the legacy authoring flow to create new filters — the redesigned multi-condition builder is shipping soon.
        </Text>
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
                  onPress={() => {
                    setTemplatePendingDelete({ id: t._id, name: t.name });
                    templateDelete.open();
                  }}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${t.name}`}
                >
                  <Trash_Stroke2_Corner0_Rounded
                    size="sm"
                    style={{ color: colors.error }}
                  />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.createBlock}>
          <TextInput
            value={newTemplateName}
            onChangeText={setNewTemplateName}
            placeholder="Template name"
            placeholderTextColor={colors.secondaryText}
            style={[styles.input, inputStyle]}
          />
          <TextInput
            value={newTemplateSubject}
            onChangeText={setNewTemplateSubject}
            placeholder="Subject (optional)"
            placeholderTextColor={colors.secondaryText}
            style={[styles.input, inputStyle]}
          />
          <TextInput
            value={newTemplateBody}
            onChangeText={setNewTemplateBody}
            placeholder="Template body"
            placeholderTextColor={colors.secondaryText}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            style={[styles.textArea, inputStyle]}
          />
          <Button
            onPress={handleCreateTemplate}
            disabled={!newTemplateName.trim() || !newTemplateBody.trim() || createTemplate.isPending}
            icon={<PlusSmall_Stroke2_Corner0_Rounded size="sm" style={{ color: '#FFFFFF' }} />}
            iconPosition="left"
          >
            {createTemplate.isPending ? 'Creating…' : 'Add template'}
          </Button>
        </View>
      </View>

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

      <Prompt.Basic
        control={filterDelete}
        title="Delete filter?"
        description={
          filterPendingDelete
            ? `"${filterPendingDelete.name}" will no longer run on new messages.`
            : ''
        }
        confirmButtonCta="Delete"
        confirmButtonColor="negative"
        onConfirm={handleDeleteFilter}
      />

      <Prompt.Basic
        control={templateDelete}
        title="Delete template?"
        description={
          templatePendingDelete
            ? `"${templatePendingDelete.name}" will be removed from your saved templates.`
            : ''
        }
        confirmButtonCta="Delete"
        confirmButtonColor="negative"
        onConfirm={handleDeleteTemplate}
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
  createBlock: {
    gap: 10,
    paddingTop: 6,
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
