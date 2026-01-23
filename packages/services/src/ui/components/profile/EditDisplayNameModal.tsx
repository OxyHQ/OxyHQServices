import React from 'react';
import { EditFieldModal } from './EditFieldModal';
import { useProfileEditing } from '../../hooks/useProfileEditing';
import { useI18n } from '../../hooks/useI18n';

interface EditDisplayNameModalProps {
  visible: boolean;
  onClose: () => void;
  initialDisplayName?: string;
  initialLastName?: string;
  theme?: 'light' | 'dark';
  onSave?: () => void;
}

export const EditDisplayNameModal: React.FC<EditDisplayNameModalProps> = ({
  visible,
  onClose,
  initialDisplayName = '',
  initialLastName = '',
  theme = 'light',
  onSave,
}) => {
  const { t } = useI18n();
  const { saveProfile } = useProfileEditing();

  return (
    <EditFieldModal
      visible={visible}
      onClose={onClose}
      title={t('editProfile.items.displayName.title') || 'Display Name'}
      theme={theme}
      onSave={onSave}
      variant="multi"
      fields={[
        {
          key: 'displayName',
          label: t('editProfile.items.displayName.firstName') || 'First Name',
          initialValue: initialDisplayName,
          placeholder: t('editProfile.items.displayName.firstNamePlaceholder') || 'Enter first name',
        },
        {
          key: 'lastName',
          label: t('editProfile.items.displayName.lastName') || 'Last Name',
          initialValue: initialLastName,
          placeholder: t('editProfile.items.displayName.lastNamePlaceholder') || 'Enter last name (optional)',
        },
      ]}
      onSubmit={async (data) => {
        return await saveProfile({
          displayName: data.displayName as string,
          lastName: data.lastName as string,
        });
      }}
    />
  );
};
