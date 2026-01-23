import React from 'react';
import { EditFieldModal } from './EditFieldModal';
import { useProfileEditing } from '../../hooks/useProfileEditing';
import { useI18n } from '../../hooks/useI18n';

interface EditBioModalProps {
  visible: boolean;
  onClose: () => void;
  initialValue?: string;
  theme?: 'light' | 'dark';
  onSave?: () => void;
}

export const EditBioModal: React.FC<EditBioModalProps> = ({
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
      title={t('editProfile.items.bio.title') || 'Bio'}
      theme={theme}
      onSave={onSave}
      variant="single"
      fields={[
        {
          key: 'bio',
          label: t('editProfile.items.bio.label') || 'Bio',
          initialValue,
          placeholder: t('editProfile.items.bio.placeholder') || 'Tell people about yourself...',
          inputProps: { multiline: true, numberOfLines: 6 },
        },
      ]}
      onSubmit={async (data) => {
        return await updateField('bio', data.bio as string);
      }}
    />
  );
};
