import React from 'react';
import { EditFieldModal } from './EditFieldModal';
import { useProfileEditing } from '../../hooks/useProfileEditing';
import { useI18n } from '../../hooks/useI18n';

interface EditUsernameModalProps {
  visible: boolean;
  onClose: () => void;
  initialValue?: string;
  theme?: 'light' | 'dark';
  onSave?: () => void;
}

export const EditUsernameModal: React.FC<EditUsernameModalProps> = ({
  visible,
  onClose,
  initialValue = '',
  theme = 'light',
  onSave,
}) => {
  const { t } = useI18n();
  const { updateField } = useProfileEditing();

  return (
    <EditFieldModal
      visible={visible}
      onClose={onClose}
      title={t('editProfile.items.username.title') || 'Username'}
      theme={theme}
      onSave={onSave}
      variant="single"
      fields={[
        {
          key: 'username',
          label: t('editProfile.items.username.label') || 'Username',
          initialValue,
          placeholder: t('editProfile.items.username.placeholder') || 'Choose a username',
          validation: (value) => {
            if (!value.trim()) {
              return t('editProfile.items.username.required') || 'Username is required';
            }
            return undefined;
          },
          inputProps: {
            autoCapitalize: 'none',
            autoCorrect: false,
          },
        },
      ]}
      onSubmit={async (data) => {
        return await updateField('username', data.username as string);
      }}
    />
  );
};
