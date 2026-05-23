import type React from 'react';
import { useState, useCallback } from 'react';
import { View, Text, TextInput } from 'react-native';
import * as Dialog from '@oxyhq/bloom/dialog';
import type { DialogControlProps } from '@oxyhq/bloom/dialog';
import * as Prompt from '@oxyhq/bloom/prompt';
import OxyIcon from '../icon/OxyIcon';
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
        <Dialog.Outer control={control} onClose={handleCleanup}>
            <Dialog.Handle />
            <Dialog.ScrollableInner label="Delete Account">
                <View className="flex-row items-center mb-4 gap-3">
                    <OxyIcon name="alert" size={32} color={theme.colors.error} />
                    <Text className="text-destructive text-xl font-bold">
                        {t('deleteAccount.title') || 'Delete Account'}
                    </Text>
                </View>

                <Text className="text-foreground text-sm leading-5 mb-5">
                    {t('deleteAccount.warning') || 'This action cannot be undone. Your account and all associated data will be permanently deleted.'}
                </Text>

                {error && (
                    <View
                        className="p-3 rounded-lg mb-4"
                        style={{ backgroundColor: `${theme.colors.error}20` }}
                    >
                        <Text className="text-destructive text-sm text-center">
                            {error}
                        </Text>
                    </View>
                )}

                <View className="mb-4">
                    <Text className="text-muted-foreground text-[13px] mb-2">
                        {t('deleteAccount.confirmLabel', { username }) || `Type "${username}" to confirm`}
                    </Text>
                    <TextInput
                        className="text-foreground bg-background text-base py-3 px-4 border rounded-lg"
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

                <Prompt.Actions>
                    <Prompt.Action
                        onPress={handleDelete}
                        color="negative"
                        cta={isDeleting ? undefined : (t('deleteAccount.confirm') || 'Delete Forever')}
                        disabled={!isValid || isDeleting}
                        shouldCloseOnPress={false}
                    />
                    <Prompt.Cancel cta={t('common.cancel') || 'Cancel'} />
                </Prompt.Actions>
            </Dialog.ScrollableInner>
        </Dialog.Outer>
    );
};

export default DeleteAccountModal;
