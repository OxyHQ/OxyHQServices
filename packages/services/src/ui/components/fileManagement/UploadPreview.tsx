import type React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
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
    visible: boolean;
    pendingFiles: PendingFile[];
    onConfirm: () => void;
    onCancel: () => void;
    onRemoveFile: (index: number) => void;
    inline?: boolean; // New prop to support inline rendering without Modal
    /** @deprecated No longer used. Colors are sourced from useTheme() internally. */
    themeStyles?: unknown;
}

const UploadPreviewContent: React.FC<{
    pendingFiles: PendingFile[];
    onConfirm: () => void;
    onCancel: () => void;
    onRemoveFile: (index: number) => void;
}> = ({
    pendingFiles,
    onConfirm,
    onCancel,
    onRemoveFile,
}) => {
    const { colors, isDark } = useTheme();
    const totalSize = pendingFiles.reduce((sum, f) => sum + f.size, 0);

    return (
        <View className="bg-background" style={fileManagementStyles.uploadPreviewContainer}>
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
                                <View style={[fileManagementStyles.uploadPreviewIconContainer, { backgroundColor: isDark ? '#333333' : '#F0F0F0' }]}>
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
            </View>
        </View>
    );
};

export const UploadPreview: React.FC<UploadPreviewProps> = ({
    visible,
    pendingFiles,
    onConfirm,
    onCancel,
    onRemoveFile,
    inline = false,
}) => {
    // If inline mode, render content directly without Modal
    if (inline) {
        if (!visible) return null;
        return (
            <UploadPreviewContent
                pendingFiles={pendingFiles}
                onConfirm={onConfirm}
                onCancel={onCancel}
                onRemoveFile={onRemoveFile}
            />
        );
    }

    // Default: render with Modal (for backward compatibility)
    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onCancel}
        >
            <UploadPreviewContent
                pendingFiles={pendingFiles}
                onConfirm={onConfirm}
                onCancel={onCancel}
                onRemoveFile={onRemoveFile}
            />
        </Modal>
    );
};

