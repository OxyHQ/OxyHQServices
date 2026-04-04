import type React from 'react';
import { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import * as Dialog from '@oxyhq/bloom/dialog';
import type { DialogControlProps } from '@oxyhq/bloom/dialog';
import * as Prompt from '@oxyhq/bloom/prompt';
import OxyIcon from '../icon/OxyIcon';
import { useTheme } from '@oxyhq/bloom/theme';
import { Loading } from '@oxyhq/bloom/loading';

interface DeleteAccountModalProps {
    control: DialogControlProps;
    username: string;
    onDelete: (password: string) => Promise<void>;
    t: (key: string, params?: Record<string, string>) => string | undefined;
}

const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({
    control,
    username,
    onDelete,
    t,
}) => {
    const theme = useTheme();
    const [password, setPassword] = useState('');
    const [confirmUsername, setConfirmUsername] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    const isValid = password.length > 0 && confirmUsername === username;

    const handleDelete = useCallback(async () => {
        if (!isValid) return;

        setError(null);
        setIsDeleting(true);

        try {
            await onDelete(password);
            // Dialog will be closed by parent on success
        } catch (err: unknown) {
            setError((err instanceof Error ? err.message : null) || t('deleteAccount.error') || 'Failed to delete account');
        } finally {
            setIsDeleting(false);
        }
    }, [isValid, password, onDelete, t]);

    const handleCleanup = useCallback(() => {
        if (isDeleting) return;
        setPassword('');
        setConfirmUsername('');
        setError(null);
        setShowPassword(false);
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
                        {t('deleteAccount.passwordLabel') || 'Enter your password'}
                    </Text>
                    <View className="flex-row items-center border border-border bg-background rounded-lg">
                        <TextInput
                            className="text-foreground flex-1 text-base py-3 px-4"
                            value={password}
                            onChangeText={setPassword}
                            placeholder={t('deleteAccount.passwordPlaceholder') || 'Password'}
                            placeholderTextColor={theme.colors.textSecondary}
                            secureTextEntry={!showPassword}
                            autoCapitalize="none"
                            editable={!isDeleting}
                        />
                        <TouchableOpacity
                            onPress={() => setShowPassword(!showPassword)}
                            className="p-3"
                        >
                            <OxyIcon
                                name={showPassword ? 'eye-off' : 'eye'}
                                size={20}
                                color={theme.colors.textSecondary}
                            />
                        </TouchableOpacity>
                    </View>
                </View>

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
