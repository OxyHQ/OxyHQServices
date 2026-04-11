/**
 * Contacts section for Settings page.
 *
 * Shows a searchable list of contacts with CRUD operations,
 * star toggle, and auto-collected badge.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { toast } from '@oxyhq/services';

import { useColors } from '@/constants/theme';
import { useContacts } from '@/hooks/queries/useContacts';
import {
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
} from '@/hooks/mutations/useContactMutations';
import type { Contact } from '@/services/emailApi';

export function ContactsSection() {
  const colors = useColors();

  const [searchQuery, setSearchQuery] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);

  // New contact form state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const { data: contactsData } = useContacts({
    q: searchQuery || undefined,
    starred: starredOnly || undefined,
  });
  const contacts = contactsData?.data ?? [];

  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();

  const resetAddForm = useCallback(() => {
    setNewName('');
    setNewEmail('');
    setNewCompany('');
    setNewNotes('');
    setShowAddForm(false);
  }, []);

  const handleCreate = useCallback(() => {
    if (!newName.trim() || !newEmail.trim()) {
      toast.error('Name and email are required.');
      return;
    }
    createContact.mutate(
      {
        name: newName.trim(),
        email: newEmail.trim(),
        company: newCompany.trim() || undefined,
        notes: newNotes.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Contact created.');
          resetAddForm();
        },
      },
    );
  }, [newName, newEmail, newCompany, newNotes, createContact, resetAddForm]);

  const handleStartEdit = useCallback((contact: Contact) => {
    setEditingContactId(contact._id);
    setEditName(contact.name);
    setEditEmail(contact.email);
    setEditCompany(contact.company ?? '');
    setEditNotes(contact.notes ?? '');
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingContactId(null);
    setEditName('');
    setEditEmail('');
    setEditCompany('');
    setEditNotes('');
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingContactId) return;
    if (!editName.trim() || !editEmail.trim()) {
      toast.error('Name and email are required.');
      return;
    }
    updateContact.mutate(
      {
        contactId: editingContactId,
        name: editName.trim(),
        email: editEmail.trim(),
        company: editCompany.trim() || undefined,
        notes: editNotes.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Contact updated.');
          handleCancelEdit();
        },
      },
    );
  }, [editingContactId, editName, editEmail, editCompany, editNotes, updateContact, handleCancelEdit]);

  const handleToggleStar = useCallback(
    (contact: Contact) => {
      updateContact.mutate({
        contactId: contact._id,
        starred: !contact.starred,
      });
    },
    [updateContact],
  );

  const handleDelete = useCallback(
    (contactId: string) => {
      if (Platform.OS === 'web') {
        if (!window.confirm('Delete this contact?')) return;
      }
      deleteContact.mutate(contactId, {
        onSuccess: () => toast.success('Contact deleted.'),
      });
    },
    [deleteContact],
  );

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={[styles.searchRow, { borderColor: colors.border }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.icon} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search contacts..."
          placeholderTextColor={colors.searchPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <MaterialCommunityIcons name="close-circle" size={16} color={colors.icon} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filters + Add button row */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[
            styles.filterChip,
            starredOnly && { backgroundColor: colors.primaryContainer },
            { borderColor: colors.border },
          ]}
          onPress={() => setStarredOnly((v) => !v)}
        >
          <MaterialCommunityIcons
            name={starredOnly ? 'star' : 'star-outline'}
            size={14}
            color={starredOnly ? colors.primary : colors.secondaryText}
          />
          <Text
            style={[
              styles.filterChipText,
              { color: starredOnly ? colors.primary : colors.secondaryText },
            ]}
          >
            Starred
          </Text>
        </TouchableOpacity>

        <View style={styles.actionsSpacer} />

        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => setShowAddForm((v) => !v)}
        >
          <MaterialCommunityIcons name={showAddForm ? 'close' : 'plus'} size={16} color="#FFFFFF" />
          <Text style={styles.addButtonText}>{showAddForm ? 'Cancel' : 'Add contact'}</Text>
        </TouchableOpacity>
      </View>

      {/* Add contact form */}
      {showAddForm && (
        <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TextInput
            style={[styles.formInput, { color: colors.text, borderColor: colors.border }]}
            value={newName}
            onChangeText={setNewName}
            placeholder="Name *"
            placeholderTextColor={colors.searchPlaceholder}
          />
          <TextInput
            style={[styles.formInput, { color: colors.text, borderColor: colors.border }]}
            value={newEmail}
            onChangeText={setNewEmail}
            placeholder="Email *"
            placeholderTextColor={colors.searchPlaceholder}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.formInput, { color: colors.text, borderColor: colors.border }]}
            value={newCompany}
            onChangeText={setNewCompany}
            placeholder="Company"
            placeholderTextColor={colors.searchPlaceholder}
          />
          <TextInput
            style={[styles.formInput, { color: colors.text, borderColor: colors.border }]}
            value={newNotes}
            onChangeText={setNewNotes}
            placeholder="Notes"
            placeholderTextColor={colors.searchPlaceholder}
            multiline
            numberOfLines={2}
            textAlignVertical="top"
          />
          <TouchableOpacity
            style={[
              styles.formSubmitButton,
              { backgroundColor: colors.primary, opacity: newName.trim() && newEmail.trim() ? 1 : 0.4 },
            ]}
            onPress={handleCreate}
            disabled={!newName.trim() || !newEmail.trim() || createContact.isPending}
          >
            <MaterialCommunityIcons name="check" size={16} color="#FFFFFF" />
            <Text style={styles.formSubmitText}>Save contact</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Contact list */}
      <View style={[styles.listCard, { backgroundColor: colors.surface }]}>
        {contacts.length === 0 && (
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
            {searchQuery ? 'No contacts match your search.' : 'No contacts yet.'}
          </Text>
        )}
        {contacts.map((contact) => (
          <View key={contact._id}>
            {editingContactId === contact._id ? (
              /* Edit form inline */
              <View style={[styles.editFormContainer, { borderBottomColor: colors.border }]}>
                <TextInput
                  style={[styles.editInput, { color: colors.text, borderColor: colors.border }]}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Name *"
                  placeholderTextColor={colors.searchPlaceholder}
                  autoFocus
                />
                <TextInput
                  style={[styles.editInput, { color: colors.text, borderColor: colors.border }]}
                  value={editEmail}
                  onChangeText={setEditEmail}
                  placeholder="Email *"
                  placeholderTextColor={colors.searchPlaceholder}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TextInput
                  style={[styles.editInput, { color: colors.text, borderColor: colors.border }]}
                  value={editCompany}
                  onChangeText={setEditCompany}
                  placeholder="Company"
                  placeholderTextColor={colors.searchPlaceholder}
                />
                <TextInput
                  style={[styles.editInput, { color: colors.text, borderColor: colors.border }]}
                  value={editNotes}
                  onChangeText={setEditNotes}
                  placeholder="Notes"
                  placeholderTextColor={colors.searchPlaceholder}
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                />
                <View style={styles.editActions}>
                  <TouchableOpacity
                    style={[styles.editSaveButton, { backgroundColor: colors.primary }]}
                    onPress={handleSaveEdit}
                    disabled={updateContact.isPending}
                  >
                    <MaterialCommunityIcons name="check" size={16} color="#FFFFFF" />
                    <Text style={styles.editSaveText}>Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleCancelEdit}>
                    <Text style={[styles.editCancelText, { color: colors.secondaryText }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              /* Contact row */
              <View style={[styles.contactRow, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => handleToggleStar(contact)} style={styles.starButton}>
                  <MaterialCommunityIcons
                    name={contact.starred ? 'star' : 'star-outline'}
                    size={20}
                    color={contact.starred ? '#FBBC04' : colors.icon}
                  />
                </TouchableOpacity>

                <View style={styles.contactInfo}>
                  <View style={styles.contactNameRow}>
                    <Text style={[styles.contactName, { color: colors.text }]} numberOfLines={1}>
                      {contact.name}
                    </Text>
                    {contact.autoCollected && (
                      <View style={[styles.badge, { backgroundColor: colors.surfaceVariant }]}>
                        <Text style={[styles.badgeText, { color: colors.secondaryText }]}>
                          Auto-collected
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.contactEmail, { color: colors.secondaryText }]} numberOfLines={1}>
                    {contact.email}
                  </Text>
                  {contact.company ? (
                    <Text style={[styles.contactCompany, { color: colors.secondaryText }]} numberOfLines={1}>
                      {contact.company}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.contactActions}>
                  <TouchableOpacity onPress={() => handleStartEdit(contact)}>
                    <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.icon} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDelete(contact._id)}>
                    <MaterialCommunityIcons name="delete-outline" size={18} color={colors.icon} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionsSpacer: {
    flex: 1,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  formCard: {
    borderRadius: 12,
    padding: 16,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  formInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  formSubmitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  formSubmitText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  listCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  emptyText: {
    fontSize: 13,
    padding: 16,
    textAlign: 'center',
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  starButton: {
    padding: 4,
  },
  contactInfo: {
    flex: 1,
    gap: 2,
  },
  contactNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contactName: {
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
  },
  contactEmail: {
    fontSize: 13,
  },
  contactCompany: {
    fontSize: 12,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  contactActions: {
    flexDirection: 'row',
    gap: 12,
  },
  editFormContainer: {
    padding: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  editInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
  },
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  editSaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editSaveText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  editCancelText: {
    fontSize: 13,
  },
});
