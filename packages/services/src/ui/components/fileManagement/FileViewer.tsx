import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { FileMetadata } from '../../../models/interfaces';
import { formatFileSize } from '../../utils/fileManagement';
import { fileManagementStyles } from './styles';
import type { ThemeStyles } from '../../hooks/useThemeStyles';
import { GroupedSection } from '../GroupedSection';

interface FileViewerProps {
    file: FileMetadata;
    fileContent: string | null;
    loadingFileContent: boolean;
    showFileDetailsInViewer: boolean;
    onToggleDetails: () => void;
    onClose: () => void;
    onDownload: (fileId: string, filename: string) => void;
    onDelete: (fileId: string, filename: string) => void;
    themeStyles: ThemeStyles;
    isOwner: boolean;
}

export const FileViewer: React.FC<FileViewerProps> = ({
    file,
    fileContent,
    loadingFileContent,
    showFileDetailsInViewer,
    onToggleDetails,
    onClose,
    onDownload,
    onDelete,
    themeStyles,
    isOwner,
}) => {
    const isImage = file.contentType.startsWith('image/');
    const isText = file.contentType.startsWith('text/') ||
        file.contentType.includes('json') ||
        file.contentType.includes('xml') ||
        file.contentType.includes('javascript') ||
        file.contentType.includes('typescript');
    const isPDF = file.contentType.includes('pdf');
    const isVideo = file.contentType.startsWith('video/');
    const isAudio = file.contentType.startsWith('audio/');

    const backgroundColor = themeStyles.backgroundColor;
    const borderColor = themeStyles.borderColor;

    const fileDetailItems = useMemo(() => {
        const items = [
            {
                id: 'filename',
                icon: 'document-text',
                iconColor: themeStyles.colors.iconSecurity,
                title: 'File Name',
                subtitle: file.filename,
            },
            {
                id: 'size',
                icon: 'server',
                iconColor: themeStyles.colors.iconStorage,
                title: 'Size',
                subtitle: formatFileSize(file.length),
            },
            {
                id: 'type',
                icon: 'code',
                iconColor: themeStyles.colors.iconData,
                title: 'Type',
                subtitle: file.contentType,
            },
            {
                id: 'uploaded',
                icon: 'time',
                iconColor: themeStyles.colors.iconPersonalInfo,
                title: 'Uploaded',
                subtitle: new Date(file.uploadDate).toLocaleString(),
            },
        ];

        if (file.metadata?.description) {
            items.push({
                id: 'description',
                icon: 'text',
                iconColor: themeStyles.colors.iconData,
                title: 'Description',
                subtitle: file.metadata.description,
            });
        }

        items.push({
            id: 'fileId',
            icon: 'key',
            iconColor: themeStyles.colors.iconSecurity,
            title: 'File ID',
            subtitle: file.id,
        });

        return items;
    }, [file, themeStyles.colors]);

    return (
        <View style={[fileManagementStyles.fileViewerContainer, { backgroundColor }]}>
            {/* File Viewer Header */}
            <View style={[fileManagementStyles.fileViewerHeader, { borderBottomColor: borderColor }]}>
                <TouchableOpacity
                    style={fileManagementStyles.backButton}
                    onPress={onClose}
                >
                    <MaterialCommunityIcons name="arrow-left" size={24} color={themeStyles.textColor} />
                </TouchableOpacity>
                <View style={fileManagementStyles.fileViewerTitleContainer}>
                    <Text style={[fileManagementStyles.fileViewerTitle, { color: themeStyles.textColor }]} numberOfLines={1}>
                        {file.filename}
                    </Text>
                    <Text style={[fileManagementStyles.fileViewerSubtitle, { color: themeStyles.colors.secondaryText }]}>
                        {formatFileSize(file.length)} • {file.contentType}
                    </Text>
                </View>
                <View style={fileManagementStyles.fileViewerActions}>
                    <TouchableOpacity
                        style={[fileManagementStyles.actionButton, { backgroundColor: themeStyles.colors.card }]}
                        onPress={() => onDownload(file.id, file.filename)}
                    >
                        <MaterialCommunityIcons name="download" size={18} color={themeStyles.primaryColor} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* File Content */}
            <ScrollView
                style={fileManagementStyles.fileViewerContent}
                contentContainerStyle={fileManagementStyles.fileViewerContentContainer}
            >
                {loadingFileContent ? (
                    <View style={fileManagementStyles.fileViewerLoading}>
                        <ActivityIndicator size="large" color={themeStyles.primaryColor} />
                        <Text style={[fileManagementStyles.fileViewerLoadingText, { color: themeStyles.textColor }]}>
                            Loading file content...
                        </Text>
                    </View>
                ) : isImage && fileContent ? (
                    <View style={fileManagementStyles.imageContainer}>
                        <ExpoImage
                            source={{ uri: fileContent }}
                            style={{ width: '100%', height: 400 }}
                            contentFit="contain"
                            transition={120}
                            cachePolicy="memory-disk"
                            onError={() => {
                                // Image failed to load
                            }}
                            accessibilityLabel={file.filename}
                        />
                    </View>
                ) : isText && fileContent ? (
                    <View style={[fileManagementStyles.textContainer, { backgroundColor: themeStyles.colors.card }]}>
                        <ScrollView style={{ flex: 1 }} nestedScrollEnabled>
                            <Text style={[fileManagementStyles.textContent, { color: themeStyles.textColor }]}>
                                {fileContent}
                            </Text>
                        </ScrollView>
                    </View>
                ) : isPDF && fileContent ? (
                    <View style={fileManagementStyles.unsupportedFileContainer}>
                        <MaterialCommunityIcons
                            name="file-pdf-box"
                            size={64}
                            color={themeStyles.colors.secondaryText}
                        />
                        <Text style={[fileManagementStyles.unsupportedFileTitle, { color: themeStyles.textColor }]}>
                            PDF Preview Not Available
                        </Text>
                        <Text style={[fileManagementStyles.unsupportedFileDescription, { color: themeStyles.colors.secondaryText }]}>
                            PDF files cannot be previewed in this viewer.{'\n'}
                            Download the file to view its contents.
                        </Text>
                        <TouchableOpacity
                            style={[fileManagementStyles.downloadButtonLarge, { backgroundColor: themeStyles.primaryColor }]}
                            onPress={() => onDownload(file.id, file.filename)}
                        >
                            <MaterialCommunityIcons name="download" size={18} color="#FFFFFF" />
                            <Text style={fileManagementStyles.downloadButtonText}>Download PDF</Text>
                        </TouchableOpacity>
                    </View>
                ) : isVideo && fileContent ? (
                    <View style={fileManagementStyles.unsupportedFileContainer}>
                        <MaterialCommunityIcons
                            name="video-outline"
                            size={64}
                            color={themeStyles.colors.secondaryText}
                        />
                        <Text style={[fileManagementStyles.unsupportedFileTitle, { color: themeStyles.textColor }]}>
                            Video Playback Not Available
                        </Text>
                        <Text style={[fileManagementStyles.unsupportedFileDescription, { color: themeStyles.colors.secondaryText }]}>
                            Video playback is not supported in this viewer.{'\n'}
                            Download the file to view it.
                        </Text>
                        <TouchableOpacity
                            style={[fileManagementStyles.downloadButtonLarge, { backgroundColor: themeStyles.primaryColor }]}
                            onPress={() => onDownload(file.id, file.filename)}
                        >
                            <MaterialCommunityIcons name="download" size={18} color="#FFFFFF" />
                            <Text style={fileManagementStyles.downloadButtonText}>Download Video</Text>
                        </TouchableOpacity>
                    </View>
                ) : isAudio && fileContent ? (
                    <View style={fileManagementStyles.unsupportedFileContainer}>
                        <MaterialCommunityIcons
                            name="music-note-outline"
                            size={64}
                            color={themeStyles.colors.secondaryText}
                        />
                        <Text style={[fileManagementStyles.unsupportedFileTitle, { color: themeStyles.textColor }]}>
                            Audio Playback Not Available
                        </Text>
                        <Text style={[fileManagementStyles.unsupportedFileDescription, { color: themeStyles.colors.secondaryText }]}>
                            Audio playback is not supported in this viewer.{'\n'}
                            Download the file to listen to it.
                        </Text>
                        <TouchableOpacity
                            style={[fileManagementStyles.downloadButtonLarge, { backgroundColor: themeStyles.primaryColor }]}
                            onPress={() => onDownload(file.id, file.filename)}
                        >
                            <MaterialCommunityIcons name="download" size={18} color="#FFFFFF" />
                            <Text style={fileManagementStyles.downloadButtonText}>Download Audio</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={fileManagementStyles.unsupportedFileContainer}>
                        <MaterialCommunityIcons
                            name="file-outline"
                            size={64}
                            color={themeStyles.colors.secondaryText}
                        />
                        <Text style={[fileManagementStyles.unsupportedFileTitle, { color: themeStyles.textColor }]}>
                            Preview Not Available
                        </Text>
                        <Text style={[fileManagementStyles.unsupportedFileDescription, { color: themeStyles.colors.secondaryText }]}>
                            This file type cannot be previewed.{'\n'}
                            Download the file to view its contents.
                        </Text>
                        <TouchableOpacity
                            style={[fileManagementStyles.downloadButtonLarge, { backgroundColor: themeStyles.primaryColor }]}
                            onPress={() => onDownload(file.id, file.filename)}
                        >
                            <MaterialCommunityIcons name="download" size={18} color="#FFFFFF" />
                            <Text style={fileManagementStyles.downloadButtonText}>Download File</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>

            {/* File Details Section - at bottom */}
            <View style={[fileManagementStyles.fileDetailsSection, { backgroundColor: themeStyles.colors.card }]}>
                <View style={fileManagementStyles.fileDetailsSectionHeader}>
                    <Text style={[fileManagementStyles.fileDetailsSectionTitle, { color: themeStyles.textColor }]}>
                        File Details
                    </Text>
                    <TouchableOpacity
                        style={fileManagementStyles.fileDetailsSectionToggle}
                        onPress={onToggleDetails}
                    >
                        <MaterialCommunityIcons
                            name={showFileDetailsInViewer ? "chevron-up" : "chevron-down"}
                            size={20}
                            color={themeStyles.colors.secondaryText}
                        />
                    </TouchableOpacity>
                </View>

                {showFileDetailsInViewer && (
                    <>
                        <View style={fileManagementStyles.fileDetailsSectionContent}>
                            <GroupedSection items={fileDetailItems} />
                        </View>

                        <View style={fileManagementStyles.fileDetailsActions}>
                            <TouchableOpacity
                                style={[fileManagementStyles.fileDetailsActionButton, { backgroundColor: themeStyles.primaryColor }]}
                                onPress={() => onDownload(file.id, file.filename)}
                            >
                                <MaterialCommunityIcons name="download" size={16} color="#FFFFFF" />
                                <Text style={fileManagementStyles.fileDetailsActionText}>Download</Text>
                            </TouchableOpacity>

                            {isOwner && (
                                <TouchableOpacity
                                    style={[fileManagementStyles.fileDetailsActionButton, { backgroundColor: themeStyles.dangerColor }]}
                                    onPress={() => {
                                        onClose();
                                        onDelete(file.id, file.filename);
                                    }}
                                >
                                    <MaterialCommunityIcons name="delete" size={16} color="#FFFFFF" />
                                    <Text style={fileManagementStyles.fileDetailsActionText}>Delete</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </>
                )}
            </View>
        </View>
    );
};

