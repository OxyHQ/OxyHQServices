import type React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Dialog from '@oxyhq/bloom/dialog';
import type { DialogControlProps } from '@oxyhq/bloom/dialog';
import * as Prompt from '@oxyhq/bloom/prompt';
import { useTheme } from '@oxyhq/bloom/theme';
import { formatFileSize, getFileIcon } from '../../utils/fileManagement';
import { fileManagementStyles } from './styles';

interface PendingFile {
    file: File | Blob;
    preview?: string;
    size: number;
    name: string;
    type: string;
}

interface UploadPreviewProps {
    control?: DialogControlProps;
    pendingFiles: PendingFile[];
    onConfirm: () => void;
    onCancel: () => void;
    onRemoveFile: (index: number) => void;
    inline?: boolean;
}

const UploadPreviewContent: React.FC<{
    pendingFiles: PendingFile[];
    onConfirm: () => void;
    onCancel: () => void;
    onRemoveFile: (index: number) => void;
    showActions?: boolean;
}> = ({
    pendingFiles,
    onConfirm,
    onCancel,
    onRemoveFile,
    showActions = true,
}) => {
    const { colors, isDark } = useTheme();
    const totalSize = pendingFiles.reduce((sum, f) => sum + f.size, 0);

    return (
        <View style={[fileManagementStyles.uploadPreviewContainer, { backgroundColor: colors.background }]}>
            <View className="border-b border-border" style={fileManagementStyles.uploadPreviewHeader}>
                <Text className="text-foreground" style={fileManagementStyles.uploadPreviewTitle}>
                    Review Files ({pendingFiles.length})
                </Text>
                <TouchableOpacity onPress={onCancel}>
                    <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
            </View>

            <ScrollView style={fileManagementStyles.uploadPreviewList}>
                {pendingFiles.map((pendingFile, index) => {
                    const isImage = pendingFile.type.startsWith('image/');
                    return (
                        <View
                            key={index}
                            className="bg-secondary border-border"
                            style={fileManagementStyles.uploadPreviewItem}
                        >
                            {isImage && pendingFile.preview ? (
                                <ExpoImage
                                    source={{ uri: pendingFile.preview }}
                                    style={fileManagementStyles.uploadPreviewThumbnail}
                                    contentFit="cover"
                                />
                            ) : (
                                <View style={[fileManagementStyles.uploadPreviewIconContainer, { backgroundColor: colors.backgroundSecondary }]}>
                                    <Ionicons
                                        name={getFileIcon(pendingFile.type) as React.ComponentProps<typeof Ionicons>['name']}
                                        size={32}
                                        color={colors.primary}
                                    />
                                </View>
                            )}
                            <View style={fileManagementStyles.uploadPreviewInfo}>
                                <Text className="text-foreground" style={fileManagementStyles.uploadPreviewName} numberOfLines={1}>
                                    {pendingFile.name}
                                </Text>
                                <Text className="text-muted-foreground" style={fileManagementStyles.uploadPreviewMeta}>
                                    {formatFileSize(pendingFile.size)} • {pendingFile.type}
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={fileManagementStyles.uploadPreviewRemove}
                                onPress={() => onRemoveFile(index)}
                            >
                                <Ionicons name="close-circle" size={24} color={colors.error} />
                            </TouchableOpacity>
                        </View>
                    );
                })}
            </ScrollView>

            <View className="border-t border-border" style={fileManagementStyles.uploadPreviewFooter}>
                <View style={fileManagementStyles.uploadPreviewStats}>
                    <Text className="text-foreground" style={fileManagementStyles.uploadPreviewStatsText}>
                        {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''}
                    </Text>
                    <Text className="text-foreground" style={fileManagementStyles.uploadPreviewStatsText}>
                        {formatFileSize(totalSize)}
                    </Text>
                </View>
                {showActions && (
                    <View style={fileManagementStyles.uploadPreviewActions}>
                        <TouchableOpacity
                            className="border-border"
                            style={[
                                fileManagementStyles.uploadPreviewCancelButton,
                                { backgroundColor: 'transparent' }
                            ]}
                            onPress={onCancel}
                        >
                            <Text className="text-foreground" style={fileManagementStyles.uploadPreviewCancelText}>
                                Cancel
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            className="bg-primary"
                            style={fileManagementStyles.uploadPreviewConfirmButton}
                            onPress={onConfirm}
                        >
                            <Ionicons name="cloud-upload" size={20} color="#FFFFFF" />
                            <Text style={fileManagementStyles.uploadPreviewConfirmText}>Upload</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </View>
    );
};

export const UploadPreview: React.FC<UploadPreviewProps> = ({
    control,
    pendingFiles,
    onConfirm,
    onCancel,
    onRemoveFile,
    inline = false,
}) => {
    // Inline mode: render content directly without Dialog
    if (inline) {
        return (
            <UploadPreviewContent
                pendingFiles={pendingFiles}
                onConfirm={onConfirm}
                onCancel={onCancel}
                onRemoveFile={onRemoveFile}
            />
        );
    }

    // Dialog mode: requires control prop
    if (!control) return null;

    return (
        <Dialog.Outer control={control} onClose={onCancel}>
            <Dialog.Handle />
            <Dialog.ScrollableInner label="Review Files">
                <UploadPreviewContent
                    pendingFiles={pendingFiles}
                    onConfirm={onConfirm}
                    onCancel={onCancel}
                    onRemoveFile={onRemoveFile}
                    showActions={false}
                />
                <Prompt.Actions>
                    <Prompt.Action
                        onPress={onConfirm}
                        cta="Upload"
                        color="primary"
                    />
                    <Prompt.Cancel cta="Cancel" />
                </Prompt.Actions>
            </Dialog.ScrollableInner>
        </Dialog.Outer>
    );
};
