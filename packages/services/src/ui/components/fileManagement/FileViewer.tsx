import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { FileMetadata } from '../../../models/interfaces';
import { formatFileSize, getFileIcon } from '../../utils/fileManagement';
import { fileManagementStyles } from './styles';
import type { ThemeStyles } from '../../hooks/useThemeStyles';

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

    return (
        <View style={[fileManagementStyles.fileViewerContainer, { backgroundColor }]}>
            {/* File Viewer Header */}
            <View style={[fileManagementStyles.fileViewerHeader, { borderBottomColor: borderColor }]}>
                <TouchableOpacity
                    style={fileManagementStyles.backButton}
                    onPress={onClose}
                >
                    <Ionicons name="arrow-back" size={24} color={themeStyles.textColor} />
                </TouchableOpacity>
                <View style={fileManagementStyles.fileViewerTitleContainer}>
                    <Text style={[fileManagementStyles.fileViewerTitle, { color: themeStyles.textColor }]} numberOfLines={1}>
                        {file.filename}
                    </Text>
                    <Text style={[fileManagementStyles.fileViewerSubtitle, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                        {formatFileSize(file.length)} • {file.contentType}
                    </Text>
                </View>
                <View style={fileManagementStyles.fileViewerActions}>
                    <TouchableOpacity
                        style={[fileManagementStyles.actionButton, { backgroundColor: themeStyles.isDarkTheme ? '#333333' : '#F0F0F0' }]}
                        onPress={() => onDownload(file.id, file.filename)}
                    >
                        <Ionicons name="download" size={20} color={themeStyles.primaryColor} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[
                            fileManagementStyles.actionButton,
                            {
                                backgroundColor: showFileDetailsInViewer
                                    ? themeStyles.primaryColor
                                    : (themeStyles.isDarkTheme ? '#333333' : '#F0F0F0')
                            }
                        ]}
                        onPress={onToggleDetails}
                    >
                        <Ionicons
                            name={showFileDetailsInViewer ? "chevron-up" : "information-circle"}
                            size={20}
                            color={showFileDetailsInViewer ? "#FFFFFF" : themeStyles.primaryColor}
                        />
                    </TouchableOpacity>
                </View>
            </View>

            {/* File Details Section */}
            {showFileDetailsInViewer && (
                <View style={[fileManagementStyles.fileDetailsSection, { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor }]}>
                    <View style={fileManagementStyles.fileDetailsSectionHeader}>
                        <Text style={[fileManagementStyles.fileDetailsSectionTitle, { color: themeStyles.textColor }]}>
                            File Details
                        </Text>
                        <TouchableOpacity
                            style={fileManagementStyles.fileDetailsSectionToggle}
                            onPress={onToggleDetails}
                        >
                            <Ionicons name="chevron-up" size={20} color={themeStyles.isDarkTheme ? '#BBBBBB' : '#666666'} />
                        </TouchableOpacity>
                    </View>

                    <View style={fileManagementStyles.fileDetailInfo}>
                        <View style={fileManagementStyles.detailRow}>
                            <Text style={[fileManagementStyles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                File Name:
                            </Text>
                            <Text style={[fileManagementStyles.detailValue, { color: themeStyles.textColor }]}>
                                {file.filename}
                            </Text>
                        </View>

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

                        <View style={fileManagementStyles.detailRow}>
                            <Text style={[fileManagementStyles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                File ID:
                            </Text>
                            <Text style={[fileManagementStyles.detailValue, { color: themeStyles.textColor, fontSize: 12, fontFamily: 'monospace' }]}>
                                {file.id}
                            </Text>
                        </View>
                    </View>

                    <View style={fileManagementStyles.fileDetailsActions}>
                        <TouchableOpacity
                            style={[fileManagementStyles.fileDetailsActionButton, { backgroundColor: themeStyles.primaryColor }]}
                            onPress={() => onDownload(file.id, file.filename)}
                        >
                            <Ionicons name="download" size={16} color="#FFFFFF" />
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
                                <Ionicons name="trash" size={16} color="#FFFFFF" />
                                <Text style={fileManagementStyles.fileDetailsActionText}>Delete</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            )}

            {/* File Content */}
            <ScrollView
                style={[
                    fileManagementStyles.fileViewerContent,
                    showFileDetailsInViewer && fileManagementStyles.fileViewerContentWithDetails
                ]}
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
                            style={{ width: '100%', height: 400, borderRadius: 8 }}
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
                    <View style={[fileManagementStyles.textContainer, { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor }]}>
                        <ScrollView style={{ flex: 1 }} nestedScrollEnabled>
                            <Text style={[fileManagementStyles.textContent, { color: themeStyles.textColor }]}>
                                {fileContent}
                            </Text>
                        </ScrollView>
                    </View>
                ) : isPDF && fileContent ? (
                    <View style={fileManagementStyles.unsupportedFileContainer}>
                        <Ionicons
                            name={getFileIcon(file.contentType) as any}
                            size={64}
                            color={themeStyles.isDarkTheme ? '#666666' : '#CCCCCC'}
                        />
                        <Text style={[fileManagementStyles.unsupportedFileTitle, { color: themeStyles.textColor }]}>
                            PDF Preview Not Available
                        </Text>
                        <Text style={[fileManagementStyles.unsupportedFileDescription, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            PDF files cannot be previewed in this viewer.{'\n'}
                            Download the file to view its contents.
                        </Text>
                        <TouchableOpacity
                            style={[fileManagementStyles.downloadButtonLarge, { backgroundColor: themeStyles.primaryColor }]}
                            onPress={() => onDownload(file.id, file.filename)}
                        >
                            <Ionicons name="download" size={20} color="#FFFFFF" />
                            <Text style={fileManagementStyles.downloadButtonText}>Download PDF</Text>
                        </TouchableOpacity>
                    </View>
                ) : isVideo && fileContent ? (
                    <View style={fileManagementStyles.unsupportedFileContainer}>
                        <Ionicons
                            name="videocam"
                            size={64}
                            color={themeStyles.isDarkTheme ? '#666666' : '#CCCCCC'}
                        />
                        <Text style={[fileManagementStyles.unsupportedFileTitle, { color: themeStyles.textColor }]}>
                            Video Playback Not Available
                        </Text>
                        <Text style={[fileManagementStyles.unsupportedFileDescription, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            Video playback is not supported in this viewer.{'\n'}
                            Download the file to view it.
                        </Text>
                        <TouchableOpacity
                            style={[fileManagementStyles.downloadButtonLarge, { backgroundColor: themeStyles.primaryColor }]}
                            onPress={() => onDownload(file.id, file.filename)}
                        >
                            <Ionicons name="download" size={20} color="#FFFFFF" />
                            <Text style={fileManagementStyles.downloadButtonText}>Download Video</Text>
                        </TouchableOpacity>
                    </View>
                ) : isAudio && fileContent ? (
                    <View style={fileManagementStyles.unsupportedFileContainer}>
                        <Ionicons
                            name="musical-notes"
                            size={64}
                            color={themeStyles.isDarkTheme ? '#666666' : '#CCCCCC'}
                        />
                        <Text style={[fileManagementStyles.unsupportedFileTitle, { color: themeStyles.textColor }]}>
                            Audio Playback Not Available
                        </Text>
                        <Text style={[fileManagementStyles.unsupportedFileDescription, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            Audio playback is not supported in this viewer.{'\n'}
                            Download the file to listen to it.
                        </Text>
                        <TouchableOpacity
                            style={[fileManagementStyles.downloadButtonLarge, { backgroundColor: themeStyles.primaryColor }]}
                            onPress={() => onDownload(file.id, file.filename)}
                        >
                            <Ionicons name="download" size={20} color="#FFFFFF" />
                            <Text style={fileManagementStyles.downloadButtonText}>Download Audio</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={fileManagementStyles.unsupportedFileContainer}>
                        <Ionicons
                            name={getFileIcon(file.contentType) as any}
                            size={64}
                            color={themeStyles.isDarkTheme ? '#666666' : '#CCCCCC'}
                        />
                        <Text style={[fileManagementStyles.unsupportedFileTitle, { color: themeStyles.textColor }]}>
                            Preview Not Available
                        </Text>
                        <Text style={[fileManagementStyles.unsupportedFileDescription, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            This file type cannot be previewed.{'\n'}
                            Download the file to view its contents.
                        </Text>
                        <TouchableOpacity
                            style={[fileManagementStyles.downloadButtonLarge, { backgroundColor: themeStyles.primaryColor }]}
                            onPress={() => onDownload(file.id, file.filename)}
                        >
                            <Ionicons name="download" size={20} color="#FFFFFF" />
                            <Text style={fileManagementStyles.downloadButtonText}>Download File</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>
        </View>
    );
};

