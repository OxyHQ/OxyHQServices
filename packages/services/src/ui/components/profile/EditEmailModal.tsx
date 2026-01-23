import React from 'react';
import { EditFieldModal } from './EditFieldModal';
import { useProfileEditing } from '../../hooks/useProfileEditing';
import { useI18n } from '../../hooks/useI18n';
import { EMAIL_REGEX } from '../../../utils/validationUtils';

interface EditEmailModalProps {
  visible: boolean;
  onClose: () => void;
  initialValue?: string;
  theme?: 'light' | 'dark';
  onSave?: () => void;
}

export const EditEmailModal: React.FC<EditEmailModalProps> = ({
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
      title={t('editProfile.items.email.title') || 'Email'}
      theme={theme}
      onSave={onSave}
      variant="single"
      fields={[
        {
          key: 'email',
          label: t('editProfile.items.email.label') || 'Email Address',
          initialValue,
          placeholder: t('editProfile.items.email.placeholder') || 'Enter your email address',
          validation: (value) => {
            if (!EMAIL_REGEX.test(value)) {
              return t('editProfile.items.email.invalid') || 'Please enter a valid email address';
            }
            return undefined;
          },
          inputProps: {
            keyboardType: 'email-address',
            autoCapitalize: 'none',
            autoCorrect: false,
          },
        },
      ]}
      onSubmit={async (data) => {
        return await updateField('email', data.email as string);
      }}
    />
  );
};
