import type React from 'react';
import { useState, useCallback } from 'react';
import { View, Text, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Dialog, type DialogControlProps } from '@oxyhq/bloom';
import { useTheme } from '@oxyhq/bloom/theme';

interface DeleteAccountModalProps {
    control: DialogControlProps;
    username: string;
    onDelete: (confirmText: string) => Promise<void>;
    t: (key: string, params?: Record<string, string>) => string | undefined;
}

const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({
    control,
    username,
    onDelete,
    t,
}) => {
    const theme = useTheme();
    const [confirmUsername, setConfirmUsername] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isValid = confirmUsername === username;

    const handleDelete = useCallback(async () => {
        if (!isValid) return;

        setError(null);
        setIsDeleting(true);

        try {
            await onDelete(confirmUsername);
            // Dialog will be closed by parent on success
        } catch (err: unknown) {
            setError((err instanceof Error ? err.message : null) || t('deleteAccount.error') || 'Failed to delete account');
        } finally {
            setIsDeleting(false);
        }
    }, [isValid, confirmUsername, onDelete, t]);

    const handleCleanup = useCallback(() => {
        if (isDeleting) return;
        setConfirmUsername('');
        setError(null);
    }, [isDeleting]);

    return (
        <Dialog
            control={control}
            onClose={handleCleanup}
            label="Delete Account"
            actions={[
                {
                    label: t('deleteAccount.confirm') || 'Delete Forever',
                    color: 'destructive',
                    onPress: handleDelete,
                    disabled: !isValid || isDeleting,
                    shouldCloseOnPress: false,
                },
                { label: t('common.cancel') || 'Cancel', color: 'cancel' },
            ]}
        >
            <View className="flex-row items-center mb-4 gap-3">
                <Ionicons name="alert-circle" size={32} color={theme.colors.error} />
                <Text className="text-text text-xl font-bold" style={{ color: theme.colors.error }}>
                    {t('deleteAccount.title') || 'Delete Account'}
                </Text>
            </View>

            <Text className="text-text text-sm leading-5 mb-5">
                {t('deleteAccount.warning') || 'This action cannot be undone. Your account and all associated data will be permanently deleted.'}
            </Text>

            {error && (
                <View
                    className="p-3 rounded-lg mb-4"
                    style={{ backgroundColor: `${theme.colors.error}20` }}
                >
                    <Text className="text-text text-sm text-center" style={{ color: theme.colors.error }}>
                        {error}
                    </Text>
                </View>
            )}

            <View className="mb-4">
                <Text className="text-text-secondary text-[13px] mb-2">
                    {t('deleteAccount.confirmLabel', { username }) || `Type "${username}" to confirm`}
                </Text>
                <TextInput
                    className="text-text bg-bg text-base py-3 px-4 border rounded-lg"
                    style={{
                        borderColor: confirmUsername === username ? theme.colors.success : theme.colors.border,
                    }}
                    value={confirmUsername}
                    onChangeText={setConfirmUsername}
                    placeholder={username}
                    placeholderTextColor={theme.colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isDeleting}
                />
            </View>
        </Dialog>
    );
};

export default DeleteAccountModal;
