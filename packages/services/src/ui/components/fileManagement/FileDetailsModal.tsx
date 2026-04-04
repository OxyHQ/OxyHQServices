import type React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Dialog from '@oxyhq/bloom/dialog';
import type { DialogControlProps } from '@oxyhq/bloom/dialog';
import * as Prompt from '@oxyhq/bloom/prompt';
import { useTheme } from '@oxyhq/bloom/theme';
import type { FileMetadata } from '@oxyhq/core';
import { formatFileSize, getFileIcon } from '../../utils/fileManagement';
import { fileManagementStyles } from './styles';

interface FileDetailsModalProps {
    control: DialogControlProps;
    file: FileMetadata | null;
    onDownload: (fileId: string, filename: string) => void;
    onDelete: (fileId: string, filename: string) => void;
    isOwner: boolean;
    onClose?: () => void;
}

export const FileDetailsModal: React.FC<FileDetailsModalProps> = ({
    control,
    file,
    onDownload,
    onDelete,
    isOwner,
    onClose,
}) => {
    const { colors } = useTheme();

    if (!file) return null;

    return (
        <Dialog.Outer control={control} onClose={onClose}>
            <Dialog.Handle />
            <Dialog.ScrollableInner label="File Details">
                <View className="bg-secondary border-border" style={fileManagementStyles.fileDetailCard}>
                    <View style={fileManagementStyles.fileDetailIcon}>
                        <Ionicons
                            name={getFileIcon(file.contentType) as React.ComponentProps<typeof Ionicons>['name']}
                            size={64}
                            color={colors.primary}
                        />
                    </View>

                    <Text className="text-foreground" style={fileManagementStyles.fileDetailName}>
                        {file.filename}
                    </Text>

                    <View style={fileManagementStyles.fileDetailInfo}>
                        <View style={fileManagementStyles.detailRow}>
                            <Text className="text-muted-foreground" style={fileManagementStyles.detailLabel}>
                                Size:
                            </Text>
                            <Text className="text-foreground" style={fileManagementStyles.detailValue}>
                                {formatFileSize(file.length)}
                            </Text>
                        </View>

                        <View style={fileManagementStyles.detailRow}>
                            <Text className="text-muted-foreground" style={fileManagementStyles.detailLabel}>
                                Type:
                            </Text>
                            <Text className="text-foreground" style={fileManagementStyles.detailValue}>
                                {file.contentType}
                            </Text>
                        </View>

                        <View style={fileManagementStyles.detailRow}>
                            <Text className="text-muted-foreground" style={fileManagementStyles.detailLabel}>
                                Uploaded:
                            </Text>
                            <Text className="text-foreground" style={fileManagementStyles.detailValue}>
                                {new Date(file.uploadDate).toLocaleString()}
                            </Text>
                        </View>

                        {file.metadata?.description && (
                            <View style={fileManagementStyles.detailRow}>
                                <Text className="text-muted-foreground" style={fileManagementStyles.detailLabel}>
                                    Description:
                                </Text>
                                <Text className="text-foreground" style={fileManagementStyles.detailValue}>
                                    {file.metadata.description}
                                </Text>
                            </View>
                        )}
                    </View>

                    <Prompt.Actions>
                        <Prompt.Action
                            onPress={() => onDownload(file.id, file.filename)}
                            cta="Download"
                            color="primary"
                        />
                        {isOwner && (
                            <Prompt.Action
                                onPress={() => onDelete(file.id, file.filename)}
                                cta="Delete"
                                color="negative"
                            />
                        )}
                    </Prompt.Actions>
                </View>
            </Dialog.ScrollableInner>
        </Dialog.Outer>
    );
};
