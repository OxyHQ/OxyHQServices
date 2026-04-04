import type React from 'react';
import { useMemo, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Image } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
// @ts-ignore - MaterialCommunityIcons is available at runtime
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@oxyhq/bloom/theme';
import type { FileMetadata } from '@oxyhq/core';
import { formatFileSize } from '../../utils/fileManagement';
import { fileManagementStyles } from './styles';
import { Colors } from '../../constants/theme';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';

interface FileViewerProps {
    file: FileMetadata;
    fileContent: string | null;
    loadingFileContent: boolean;
    showFileDetailsInViewer: boolean;
    onToggleDetails: () => void;
    onClose: () => void;
    onDownload: (fileId: string, filename: string) => void;
    onDelete: (fileId: string, filename: string) => void;
    isOwner: boolean;
    /** @deprecated No longer used. Colors are sourced from useTheme() internally. */
    themeStyles?: unknown;
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
    isOwner,
}) => {
    const { colors, isDark } = useTheme();
    const constantColors = Colors[isDark ? 'dark' : 'light'];
    const isImage = file.contentType.startsWith('image/');
    const isText = file.contentType.startsWith('text/') ||
        file.contentType.includes('json') ||
        file.contentType.includes('xml') ||
        file.contentType.includes('javascript') ||
        file.contentType.includes('typescript');
    const isPDF = file.contentType.includes('pdf');
    const isVideo = file.contentType.startsWith('video/');
    const isAudio = file.contentType.startsWith('audio/');

    const bgColor = isImage && fileContent
        ? 'transparent'
        : undefined;

    const [containerWidth, setContainerWidth] = useState<number>(0);
    const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

    // Load image dimensions when image content is available
    useEffect(() => {
        if (isImage && fileContent) {
            Image.getSize(
                fileContent,
                (width, height) => {
                    setImageDimensions({ width, height });
                },
                () => {
                    // Fallback if dimensions can't be loaded
                    setImageDimensions({ width: 400, height: 400 });
                }
            );
        } else {
            setImageDimensions(null);
        }
    }, [isImage, fileContent]);

    // Calculate display size based on natural dimensions and max constraints
    // Use natural size when smaller, scale down when larger
    const imageDisplaySize = useMemo(() => {
        if (!imageDimensions || !containerWidth) {
            // Return default size while loading
            return { width: 400, height: 400 };
        }
        
        const maxWidth = containerWidth - 24; // Account for padding
        const maxHeight = 500;
        const aspectRatio = imageDimensions.width / imageDimensions.height;
        
        // Start with natural dimensions
        let displayWidth = imageDimensions.width;
        let displayHeight = imageDimensions.height;
        
        // Only scale down if exceeds max width
        if (displayWidth > maxWidth) {
            displayWidth = maxWidth;
            displayHeight = displayWidth / aspectRatio;
        }
        
        // Only scale down if exceeds max height
        if (displayHeight > maxHeight) {
            displayHeight = maxHeight;
            displayWidth = displayHeight * aspectRatio;
        }
        
        return { width: displayWidth, height: displayHeight };
    }, [imageDimensions, containerWidth]);

    const fileDetailItems = useMemo(() => {
        const items: Array<{ id: string; iconName: string; iconColor: string; title: string; description: string }> = [
            {
                id: 'filename',
                iconName: 'file-document',
                iconColor: constantColors.iconSecurity,
                title: 'File Name',
                description: file.filename,
            },
            {
                id: 'size',
                iconName: 'server',
                iconColor: constantColors.iconStorage,
                title: 'Size',
                description: formatFileSize(file.length),
            },
            {
                id: 'type',
                iconName: 'code-tags',
                iconColor: constantColors.iconData,
                title: 'Type',
                description: file.contentType,
            },
            {
                id: 'uploaded',
                iconName: 'clock',
                iconColor: constantColors.iconPersonalInfo,
                title: 'Uploaded',
                description: new Date(file.uploadDate).toLocaleString(),
            },
        ];

        if (file.metadata?.description) {
            items.push({
                id: 'description',
                iconName: 'text',
                iconColor: constantColors.iconData,
                title: 'Description',
                description: file.metadata.description,
            });
        }

        items.push({
            id: 'fileId',
            iconName: 'key',
            iconColor: constantColors.iconSecurity,
            title: 'File ID',
            description: file.id,
        });

        return items;
    }, [file, constantColors]);

    return (
        <View
            className={isImage && fileContent ? undefined : 'bg-background'}
            style={[fileManagementStyles.fileViewerContainer, bgColor ? { backgroundColor: bgColor } : undefined]}
        >
            {/* Blurred Background Image - only for images */}
            {isImage && fileContent && (
                <>
                    <ExpoImage
                        source={{ uri: fileContent }}
                        style={fileManagementStyles.backgroundImage}
                        contentFit="cover"
                        blurRadius={50}
                        transition={120}
                        cachePolicy="memory-disk"
                    />
                    <View style={[fileManagementStyles.backgroundOverlay, { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.85)' }]} />
                </>
            )}

            {/* Floating Back Button */}
            <TouchableOpacity
                className="bg-card"
                style={fileManagementStyles.floatingBackButton}
                onPress={onClose}
            >
                <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
            </TouchableOpacity>

            {/* Floating Download Button */}
            <TouchableOpacity
                className="bg-card"
                style={fileManagementStyles.floatingDownloadButton}
                onPress={() => onDownload(file.id, file.filename)}
            >
                <MaterialCommunityIcons name="download" size={20} color={colors.primary} />
            </TouchableOpacity>

            {/* File Content */}
            <ScrollView
                style={fileManagementStyles.fileViewerContent}
                contentContainerStyle={fileManagementStyles.fileViewerContentContainer}
            >
                {loadingFileContent ? (
                    <View style={fileManagementStyles.fileViewerLoading}>
                        <ActivityIndicator size="large" color={colors.primary} />
                        <Text className="text-foreground" style={fileManagementStyles.fileViewerLoadingText}>
                            Loading file content...
                        </Text>
                    </View>
                ) : isImage && fileContent ? (
                    <View
                        style={fileManagementStyles.imageContainer}
                        onLayout={(e) => {
                            const width = e.nativeEvent.layout.width;
                            if (width > 0) {
                                setContainerWidth(width);
                            }
                        }}
                    >
                        <View
                            style={[
                                fileManagementStyles.imageWrapper,
                                {
                                    width: imageDisplaySize.width,
                                    height: imageDisplaySize.height,
                                }
                            ]}
                        >
                            <ExpoImage
                                source={{ uri: fileContent }}
                                style={{
                                    width: imageDisplaySize.width,
                                    height: imageDisplaySize.height,
                                }}
                                contentFit="contain"
                                transition={120}
                                cachePolicy="memory-disk"
                                onError={() => {
                                    // Image failed to load
                                }}
                                accessibilityLabel={file.filename}
                            />
                        </View>
                    </View>
                ) : isText && fileContent ? (
                    <View className="bg-card" style={fileManagementStyles.textContainer}>
                        <ScrollView style={{ flex: 1 }} nestedScrollEnabled>
                            <Text className="text-foreground" style={fileManagementStyles.textContent}>
                                {fileContent}
                            </Text>
                        </ScrollView>
                    </View>
                ) : isPDF && fileContent ? (
                    <View style={fileManagementStyles.unsupportedFileContainer}>
                        <MaterialCommunityIcons
                            name="file-pdf-box"
                            size={64}
                            color={colors.textSecondary}
                        />
                        <Text className="text-foreground" style={fileManagementStyles.unsupportedFileTitle}>
                            PDF Preview Not Available
                        </Text>
                        <Text className="text-muted-foreground" style={fileManagementStyles.unsupportedFileDescription}>
                            PDF files cannot be previewed in this viewer.{'\n'}
                            Download the file to view its contents.
                        </Text>
                        <TouchableOpacity
                            className="bg-primary"
                            style={fileManagementStyles.downloadButtonLarge}
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
                            color={colors.textSecondary}
                        />
                        <Text className="text-foreground" style={fileManagementStyles.unsupportedFileTitle}>
                            Video Playback Not Available
                        </Text>
                        <Text className="text-muted-foreground" style={fileManagementStyles.unsupportedFileDescription}>
                            Video playback is not supported in this viewer.{'\n'}
                            Download the file to view it.
                        </Text>
                        <TouchableOpacity
                            className="bg-primary"
                            style={fileManagementStyles.downloadButtonLarge}
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
                            color={colors.textSecondary}
                        />
                        <Text className="text-foreground" style={fileManagementStyles.unsupportedFileTitle}>
                            Audio Playback Not Available
                        </Text>
                        <Text className="text-muted-foreground" style={fileManagementStyles.unsupportedFileDescription}>
                            Audio playback is not supported in this viewer.{'\n'}
                            Download the file to listen to it.
                        </Text>
                        <TouchableOpacity
                            className="bg-primary"
                            style={fileManagementStyles.downloadButtonLarge}
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
                            color={colors.textSecondary}
                        />
                        <Text className="text-foreground" style={fileManagementStyles.unsupportedFileTitle}>
                            Preview Not Available
                        </Text>
                        <Text className="text-muted-foreground" style={fileManagementStyles.unsupportedFileDescription}>
                            This file type cannot be previewed.{'\n'}
                            Download the file to view its contents.
                        </Text>
                        <TouchableOpacity
                            className="bg-primary"
                            style={fileManagementStyles.downloadButtonLarge}
                            onPress={() => onDownload(file.id, file.filename)}
                        >
                            <MaterialCommunityIcons name="download" size={18} color="#FFFFFF" />
                            <Text style={fileManagementStyles.downloadButtonText}>Download File</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>

            {/* File Details Section - at bottom */}
            <View className="bg-card" style={fileManagementStyles.fileDetailsSection}>
                <View style={fileManagementStyles.fileDetailsSectionHeader}>
                    <Text className="text-foreground" style={fileManagementStyles.fileDetailsSectionTitle}>
                        File Details
                    </Text>
                    <TouchableOpacity
                        style={fileManagementStyles.fileDetailsSectionToggle}
                        onPress={onToggleDetails}
                    >
                        <MaterialCommunityIcons
                            name={showFileDetailsInViewer ? "chevron-up" : "chevron-down"}
                            size={20}
                            color={colors.textSecondary}
                        />
                    </TouchableOpacity>
                </View>

                {showFileDetailsInViewer && (
                    <>
                        <View style={fileManagementStyles.fileDetailsSectionContent}>
                            <SettingsListGroup>
                                {fileDetailItems.map((item) => (
                                    <SettingsListItem
                                        key={item.id}
                                        icon={<MaterialCommunityIcons name={item.iconName} size={20} color={item.iconColor} />}
                                        title={item.title}
                                        description={item.description}
                                        showChevron={false}
                                    />
                                ))}
                            </SettingsListGroup>
                        </View>

                        {isOwner && (
                            <View style={fileManagementStyles.fileDetailsActions}>
                                <TouchableOpacity
                                    className="bg-destructive"
                                    style={fileManagementStyles.fileDetailsActionButton}
                                    onPress={() => {
                                        onClose();
                                        onDelete(file.id, file.filename);
                                    }}
                                >
                                    <MaterialCommunityIcons name="delete" size={16} color="#FFFFFF" />
                                    <Text style={fileManagementStyles.fileDetailsActionText}>Delete</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </>
                )}
            </View>
        </View>
    );
};

