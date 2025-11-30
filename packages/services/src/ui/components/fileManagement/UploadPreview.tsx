import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { formatFileSize, getFileIcon } from '../../utils/fileManagement';
import { fileManagementStyles } from './styles';
import type { ThemeStyles } from '../../hooks/useThemeStyles';

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
    themeStyles: ThemeStyles;
}

export const UploadPreview: React.FC<UploadPreviewProps> = ({
    visible,
    pendingFiles,
    onConfirm,
    onCancel,
    onRemoveFile,
    themeStyles,
}) => {
    const backgroundColor = themeStyles.backgroundColor;
    const borderColor = themeStyles.borderColor;
    const totalSize = pendingFiles.reduce((sum, f) => sum + f.size, 0);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onCancel}
        >
            <View style={[fileManagementStyles.uploadPreviewContainer, { backgroundColor }]}>
                <View style={[fileManagementStyles.uploadPreviewHeader, { borderBottomColor: borderColor }]}>
                    <Text style={[fileManagementStyles.uploadPreviewTitle, { color: themeStyles.textColor }]}>
                        Review Files ({pendingFiles.length})
                    </Text>
                    <TouchableOpacity onPress={onCancel}>
                        <Ionicons name="close" size={24} color={themeStyles.textColor} />
                    </TouchableOpacity>
                </View>

                <ScrollView style={fileManagementStyles.uploadPreviewList}>
                    {pendingFiles.map((pendingFile, index) => {
                        const isImage = pendingFile.type.startsWith('image/');
                        return (
                            <View
                                key={index}
                                style={[
                                    fileManagementStyles.uploadPreviewItem,
                                    { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor }
                                ]}
                            >
                                {isImage && pendingFile.preview ? (
                                    <ExpoImage
                                        source={{ uri: pendingFile.preview }}
                                        style={fileManagementStyles.uploadPreviewThumbnail}
                                        contentFit="cover"
                                    />
                                ) : (
                                    <View style={[fileManagementStyles.uploadPreviewIconContainer, { backgroundColor: themeStyles.isDarkTheme ? '#333333' : '#F0F0F0' }]}>
                                        <Ionicons
                                            name={getFileIcon(pendingFile.type) as any}
                                            size={32}
                                            color={themeStyles.primaryColor}
                                        />
                                    </View>
                                )}
                                <View style={fileManagementStyles.uploadPreviewInfo}>
                                    <Text style={[fileManagementStyles.uploadPreviewName, { color: themeStyles.textColor }]} numberOfLines={1}>
                                        {pendingFile.name}
                                    </Text>
                                    <Text style={[fileManagementStyles.uploadPreviewMeta, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        {formatFileSize(pendingFile.size)} • {pendingFile.type}
                                    </Text>
                                </View>
                                <TouchableOpacity
                                    style={fileManagementStyles.uploadPreviewRemove}
                                    onPress={() => onRemoveFile(index)}
                                >
                                    <Ionicons name="close-circle" size={24} color={themeStyles.dangerColor} />
                                </TouchableOpacity>
                            </View>
                        );
                    })}
                </ScrollView>

                <View style={[fileManagementStyles.uploadPreviewFooter, { borderTopColor: borderColor }]}>
                    <View style={fileManagementStyles.uploadPreviewStats}>
                        <Text style={[fileManagementStyles.uploadPreviewStatsText, { color: themeStyles.textColor }]}>
                            {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''}
                        </Text>
                        <Text style={[fileManagementStyles.uploadPreviewStatsText, { color: themeStyles.textColor }]}>
                            {formatFileSize(totalSize)}
                        </Text>
                    </View>
                    <View style={fileManagementStyles.uploadPreviewActions}>
                        <TouchableOpacity
                            style={[
                                fileManagementStyles.uploadPreviewCancelButton,
                                { borderColor, backgroundColor: 'transparent' }
                            ]}
                            onPress={onCancel}
                        >
                            <Text style={[fileManagementStyles.uploadPreviewCancelText, { color: themeStyles.textColor }]}>
                                Cancel
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[fileManagementStyles.uploadPreviewConfirmButton, { backgroundColor: themeStyles.primaryColor }]}
                            onPress={onConfirm}
                        >
                            <Ionicons name="cloud-upload" size={20} color="#FFFFFF" />
                            <Text style={fileManagementStyles.uploadPreviewConfirmText}>Upload</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

