/**
 * Contacts subscreen — create, edit, star, and delete saved contacts.
 *
 * screen → mutation hook (`useContactMutations`) → API. The list reacts
 * instantly via the optimistic updates in the mutation hooks; this component
 * only orchestrates form state and confirmation dialogs.
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
import { Dialog, useDialogControl, toast } from '@oxyhq/bloom';
import {
  UserCircle_Stroke2_Corner0_Rounded,
  MagnifyingGlass_Stroke2_Corner0_Rounded,
  Pencil_Stroke2_Corner0_Rounded,
  Trash_Stroke2_Corner0_Rounded,
  PlusSmall_Stroke2_Corner0_Rounded,
  CircleCheck_Stroke2_Corner0_Rounded,
} from '@oxyhq/bloom/icons';

import { useColors } from '@/constants/theme';
import { SectionHeader } from '@/components/settings/SectionHeader';
import { useContacts } from '@/hooks/queries/useContacts';
import {
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
} from '@/hooks/mutations/useContactMutations';

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export function ContactsSection() {
  const colors = useColors();
  const theme = useTheme();

  const [search, setSearch] = useState('');
  const { data: contacts = [] } = useContacts(search);
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [starred, setStarred] = useState(false);

  const deleteConfirm = useDialogControl();
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setName('');
    setEmail('');
    setCompany('');
    setNotes('');
    setStarred(false);
  }, []);

  const startEdit = useCallback(
    (contact: { _id: string; name: string; email: string; company?: string; notes?: string; starred: boolean }) => {
      setEditingId(contact._id);
      setName(contact.name);
      setEmail(contact.email);
      setCompany(contact.company ?? '');
      setNotes(contact.notes ?? '');
      setStarred(contact.starred);
    },
    [],
  );

  const formValid = name.trim().length > 0 && isValidEmail(email.trim());
  const submitting = editingId ? updateContact.isPending : createContact.isPending;

  const handleSubmit = useCallback(() => {
    if (!formValid) {
      toast.error('Enter a name and a valid email.');
      return;
    }
    const payload = {
      name: name.trim(),
      email: email.trim(),
      company: company.trim() || undefined,
      notes: notes.trim() || undefined,
      starred,
    };
    if (editingId) {
      updateContact.mutate(
        { contactId: editingId, ...payload },
        {
          onSuccess: () => {
            resetForm();
            toast.success('Contact updated.');
          },
        },
      );
      return;
    }
    createContact.mutate(payload, {
      onSuccess: () => {
        resetForm();
        toast.success('Contact added.');
      },
    });
  }, [formValid, name, email, company, notes, starred, editingId, updateContact, createContact, resetForm]);

  const handleDelete = useCallback(() => {
    if (!pendingDelete) return;
    deleteContact.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success('Contact deleted.');
        if (editingId === pendingDelete.id) resetForm();
        setPendingDelete(null);
      },
    });
  }, [pendingDelete, deleteContact, editingId, resetForm]);

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
      {/* Search + list */}
      <View style={styles.subsection}>
        <SectionHeader icon={UserCircle_Stroke2_Corner0_Rounded} title="Your contacts" />
        <View style={[styles.searchRow, { borderColor: colors.border, backgroundColor: theme.colors.background }]}>
          <MagnifyingGlass_Stroke2_Corner0_Rounded size="sm" style={{ color: colors.secondaryText }} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search contacts"
            placeholderTextColor={colors.secondaryText}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.text }]}
          />
        </View>
        {contacts.length === 0 ? (
          <Admonition type="info">
            {search.trim()
              ? 'No contacts match your search.'
              : 'No contacts yet. Add your frequent recipients below for faster composing.'}
          </Admonition>
        ) : (
          <View style={[styles.itemList, { borderColor: colors.border }]}>
            {contacts.map((c, idx) => (
              <View
                key={c._id}
                style={[
                  styles.itemRow,
                  idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                  editingId === c._id && { backgroundColor: theme.colors.background },
                ]}
              >
                <View style={styles.itemMain}>
                  <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
                    {c.starred ? '★ ' : ''}{c.name}
                  </Text>
                  <Text style={[styles.itemSub, { color: colors.secondaryText }]} numberOfLines={1}>
                    {c.company ? `${c.email} · ${c.company}` : c.email}
                  </Text>
                </View>
                <Pressable
                  onPress={() => startEdit(c)}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${c.name}`}
                >
                  <Pencil_Stroke2_Corner0_Rounded size="sm" style={{ color: colors.icon }} />
                </Pressable>
                <Pressable
                  onPress={() => {
                    setPendingDelete({ id: c._id, name: c.name });
                    deleteConfirm.open();
                  }}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${c.name}`}
                >
                  <Trash_Stroke2_Corner0_Rounded size="sm" style={{ color: colors.error }} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Create / edit form */}
      <View style={styles.subsection}>
        <SectionHeader
          icon={editingId ? Pencil_Stroke2_Corner0_Rounded : PlusSmall_Stroke2_Corner0_Rounded}
          title={editingId ? 'Edit contact' : 'Add contact'}
        />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={colors.secondaryText}
          style={[styles.input, inputStyle]}
        />
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={colors.secondaryText}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, inputStyle]}
        />
        <TextInput
          value={company}
          onChangeText={setCompany}
          placeholder="Company (optional)"
          placeholderTextColor={colors.secondaryText}
          style={[styles.input, inputStyle]}
        />
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes (optional)"
          placeholderTextColor={colors.secondaryText}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          style={[styles.textArea, inputStyle]}
        />
        <View style={styles.starRow}>
          <Text style={[styles.starLabel, { color: colors.text }]}>Star this contact</Text>
          <Switch value={starred} onValueChange={setStarred} />
        </View>
        <View style={styles.buttonRow}>
          <Button
            onPress={handleSubmit}
            disabled={!formValid || submitting}
            icon={
              editingId ? (
                <CircleCheck_Stroke2_Corner0_Rounded size="sm" style={{ color: '#FFFFFF' }} />
              ) : (
                <PlusSmall_Stroke2_Corner0_Rounded size="sm" style={{ color: '#FFFFFF' }} />
              )
            }
            iconPosition="left"
          >
            {submitting
              ? editingId
                ? 'Saving…'
                : 'Adding…'
              : editingId
                ? 'Save changes'
                : 'Add contact'}
          </Button>
          {editingId ? (
            <Button variant="text" onPress={resetForm}>
              Cancel
            </Button>
          ) : null}
        </View>
      </View>

      <Dialog
        control={deleteConfirm}
        title="Delete contact?"
        description={
          pendingDelete ? `"${pendingDelete.name}" will be removed from your contacts.` : ''
        }
        actions={[
          { label: 'Delete', color: 'destructive', onPress: handleDelete },
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
    gap: 12,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
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
    minHeight: 72,
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  starLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
});
