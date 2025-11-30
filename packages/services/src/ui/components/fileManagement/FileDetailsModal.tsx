import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FileMetadata } from '../../../models/interfaces';
import { formatFileSize, getFileIcon } from '../../utils/fileManagement';
import { fileManagementStyles } from './styles';
import type { ThemeStyles } from '../../hooks/useThemeStyles';

interface FileDetailsModalProps {
    visible: boolean;
    file: FileMetadata | null;
    onClose: () => void;
    onDownload: (fileId: string, filename: string) => void;
    onDelete: (fileId: string, filename: string) => void;
    themeStyles: ThemeStyles;
    isOwner: boolean;
}

export const FileDetailsModal: React.FC<FileDetailsModalProps> = ({
    visible,
    file,
    onClose,
    onDownload,
    onDelete,
    themeStyles,
    isOwner,
}) => {
    const backgroundColor = themeStyles.backgroundColor;
    const borderColor = themeStyles.borderColor;

    if (!file) return null;

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <View style={[fileManagementStyles.modalContainer, { backgroundColor }]}>
                <View style={[fileManagementStyles.modalHeader, { borderBottomColor: borderColor }]}>
                    <TouchableOpacity
                        style={fileManagementStyles.modalCloseButton}
                        onPress={onClose}
                    >
                        <Ionicons name="close" size={24} color={themeStyles.textColor} />
                    </TouchableOpacity>
                    <Text style={[fileManagementStyles.modalTitle, { color: themeStyles.textColor }]}>File Details</Text>
                    <View style={fileManagementStyles.modalPlaceholder} />
                </View>

                <ScrollView style={fileManagementStyles.modalContent}>
                    <View style={[fileManagementStyles.fileDetailCard, { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor }]}>
                        <View style={fileManagementStyles.fileDetailIcon}>
                            <Ionicons
                                name={getFileIcon(file.contentType) as any}
                                size={64}
                                color={themeStyles.primaryColor}
                            />
                        </View>

                        <Text style={[fileManagementStyles.fileDetailName, { color: themeStyles.textColor }]}>
                            {file.filename}
                        </Text>

                        <View style={fileManagementStyles.fileDetailInfo}>
                            <View style={fileManagementStyles.detailRow}>
                                <Text style={[fileManagementStyles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Size:
                                </Text>
                                <Text style={[fileManagementStyles.detailValue, { color: themeStyles.textColor }]}>
                                    {formatFileSize(file.length)}
                                </Text>
                            </View>

                            <View style={fileManagementStyles.detailRow}>
                                <Text style={[fileManagementStyles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Type:
                                </Text>
                                <Text style={[fileManagementStyles.detailValue, { color: themeStyles.textColor }]}>
                                    {file.contentType}
                                </Text>
                            </View>

                            <View style={fileManagementStyles.detailRow}>
                                <Text style={[fileManagementStyles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Uploaded:
                                </Text>
                                <Text style={[fileManagementStyles.detailValue, { color: themeStyles.textColor }]}>
                                    {new Date(file.uploadDate).toLocaleString()}
                                </Text>
                            </View>

                            {file.metadata?.description && (
                                <View style={fileManagementStyles.detailRow}>
                                    <Text style={[fileManagementStyles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        Description:
                                    </Text>
                                    <Text style={[fileManagementStyles.detailValue, { color: themeStyles.textColor }]}>
                                        {file.metadata.description}
                                    </Text>
                                </View>
                            )}
                        </View>

                        <View style={fileManagementStyles.modalActions}>
                            <TouchableOpacity
                                style={[fileManagementStyles.modalActionButton, { backgroundColor: themeStyles.primaryColor }]}
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
                                    style={[fileManagementStyles.modalActionButton, { backgroundColor: themeStyles.dangerColor }]}
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

