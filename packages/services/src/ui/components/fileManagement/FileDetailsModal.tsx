import type React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@oxyhq/bloom/theme';
import type { FileMetadata } from '@oxyhq/core';
import { formatFileSize, getFileIcon } from '../../utils/fileManagement';
import { fileManagementStyles } from './styles';

interface FileDetailsModalProps {
    visible: boolean;
    file: FileMetadata | null;
    onClose: () => void;
    onDownload: (fileId: string, filename: string) => void;
    onDelete: (fileId: string, filename: string) => void;
    isOwner: boolean;
    /** @deprecated No longer used. Colors are sourced from useTheme() internally. */
    themeStyles?: unknown;
}

export const FileDetailsModal: React.FC<FileDetailsModalProps> = ({
    visible,
    file,
    onClose,
    onDownload,
    onDelete,
    isOwner,
}) => {
    const { colors } = useTheme();

    if (!file) return null;

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <View className="bg-background" style={fileManagementStyles.modalContainer}>
                <View className="border-b border-border" style={fileManagementStyles.modalHeader}>
                    <TouchableOpacity
                        style={fileManagementStyles.modalCloseButton}
                        onPress={onClose}
                    >
                        <Ionicons name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text className="text-foreground" style={fileManagementStyles.modalTitle}>File Details</Text>
                    <View style={fileManagementStyles.modalPlaceholder} />
                </View>

                <ScrollView style={fileManagementStyles.modalContent}>
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

                        <View style={fileManagementStyles.modalActions}>
                            <TouchableOpacity
                                className="bg-primary"
                                style={fileManagementStyles.modalActionButton}
                                onPress={() => {
                                    onDownload(file.id, file.filename);
                                    onClose();
                                }}
                            >
                                <Ionicons name="download" size={20} color="#FFFFFF" />
                                <Text style={fileManagementStyles.modalActionText}>Download</Text>
                            </TouchableOpacity>

                            {isOwner && (
                                <TouchableOpacity
                                    className="bg-destructive"
                                    style={fileManagementStyles.modalActionButton}
                                    onPress={() => {
                                        onClose();
                                        onDelete(file.id, file.filename);
                                    }}
                                >
                                    <Ionicons name="trash" size={20} color="#FFFFFF" />
                                    <Text style={fileManagementStyles.modalActionText}>Delete</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                </ScrollView>
            </View>
        </Modal>
    );
};

