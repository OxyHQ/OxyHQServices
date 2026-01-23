import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EditFieldModal } from './EditFieldModal';
import { useProfileEditing } from '../../hooks/useProfileEditing';
import { useI18n } from '../../hooks/useI18n';

interface Location {
  id: string;
  name: string;
  label?: string;
  coordinates?: { lat: number; lon: number };
  [key: string]: unknown;
}

interface EditLocationModalProps {
  visible: boolean;
  onClose: () => void;
  initialLocations?: Location[];
  theme?: 'light' | 'dark';
  onSave?: () => void;
}

export const EditLocationModal: React.FC<EditLocationModalProps> = ({
  visible,
  onClose,
  initialLocations = [],
  theme = 'light',
  onSave,
}) => {
  const { t } = useI18n();
  const { saveProfile } = useProfileEditing();

  return (
    <EditFieldModal<Location>
      visible={visible}
      onClose={onClose}
      title={t('editProfile.items.locations.title') || 'Locations'}
      theme={theme}
      onSave={onSave}
      variant="list"
      listConfig={{
        items: initialLocations,
        addItemLabel: t('editProfile.items.locations.add') || 'Add Location',
        listTitle: t('editProfile.items.locations.yourLocations') || 'Your Locations',
        addItemPlaceholder: t('editProfile.items.locations.placeholder') || 'Enter location name',
        createItem: (value: string) => ({
          id: `location-${Date.now()}`,
          name: value.trim(),
        }),
        renderItem: (item: Location, onRemove: () => void, colors: Record<string, string>) => (
          <View
            style={[
              styles.locationItem,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.locationName, { color: colors.text }]}>
              {item.name}
            </Text>
            <TouchableOpacity onPress={onRemove} style={styles.removeButton}>
              <Ionicons name="trash-outline" size={18} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        ),
      }}
      onSubmit={async (data) => {
        return await saveProfile({ locations: data.items as Location[] });
      }}
    />
  );
};

const styles = StyleSheet.create({
  locationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  locationName: {
    fontSize: 16,
    flex: 1,
  },
  removeButton: {
    padding: 8,
  },
});
