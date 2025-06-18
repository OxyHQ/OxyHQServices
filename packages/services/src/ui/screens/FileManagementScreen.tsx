import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Platform,
    RefreshControl,
    Dimensions,
    Modal,
    TextInput,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { Ionicons } from '@expo/vector-icons';
import { FileMetadata } from '../../models/interfaces';

interface FileManagementScreenProps extends BaseScreenProps {
    userId?: string;
}

const FileManagementScreen: React.FC<FileManagementScreenProps> = ({
    onClose,
    theme,
    goBack,
    navigate,
    userId,
}) => {
    const { user, oxyServices } = useOxy();
    const [files, setFiles] = useState<FileMetadata[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{current: number, total: number} | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<FileMetadata | null>(null);
    const [showFileDetails, setShowFileDetails] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filteredFiles, setFilteredFiles] = useState<FileMetadata[]>([]);
    const [isDragging, setIsDragging] = useState(false);

    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#f2f2f2';
    const secondaryBackgroundColor = isDarkTheme ? '#222222' : '#FFFFFF';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';
    const primaryColor = '#007AFF';
    const dangerColor = '#FF3B30';
    const successColor = '#34C759';

    const targetUserId = userId || user?.id;
    
    console.log('FileManagementScreen initialized:', { 
        user: user?.id, 
        targetUserId, 
        hasOxyServices: !!oxyServices,
        filesCount: files.length,
        filteredFilesCount: filteredFiles.length
    });

    const loadFiles = useCallback(async (isRefresh = false) => {
        if (!targetUserId) return;

        try {
            if (isRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            const response = await oxyServices.listUserFiles(targetUserId);
            console.log('Files loaded:', response);
            console.log('First file (if any):', response.files?.[0]);
            setFiles(response.files || []);
        } catch (error: any) {
            console.error('Failed to load files:', error);
            console.error('Error details:', error.response?.data || error.message);
            toast.error(error.message || 'Failed to load files');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [targetUserId, oxyServices]);

    // Filter files based on search query
    useEffect(() => {
        console.log('Filtering files:', { filesCount: files.length, searchQuery });
        if (!searchQuery.trim()) {
            setFilteredFiles(files);
        } else {
            const query = searchQuery.toLowerCase();
            const filtered = files.filter(file => 
                file.filename.toLowerCase().includes(query) ||
                file.contentType.toLowerCase().includes(query) ||
                (file.metadata?.description && file.metadata.description.toLowerCase().includes(query))
            );
            setFilteredFiles(filtered);
        }
        console.log('Filtered files count:', filteredFiles.length);
    }, [files, searchQuery]);

    const processFileUploads = async (selectedFiles: File[]) => {
        if (selectedFiles.length === 0) return;

        try {
            // Show initial progress
            setUploadProgress({ current: 0, total: selectedFiles.length });
            
            // Validate file sizes (example: 50MB limit per file)
            const maxSize = 50 * 1024 * 1024; // 50MB
            const oversizedFiles = selectedFiles.filter(file => file.size > maxSize);
            
            if (oversizedFiles.length > 0) {
                const fileList = oversizedFiles.map(f => f.name).join('\n');
                window.alert(`File Size Limit\n\nThe following files are too large (max 50MB):\n${fileList}`);
                return;
            }

            // Option 1: Bulk upload (faster, all-or-nothing) for 5 or fewer files
            if (selectedFiles.length <= 5) {
                const filenames = selectedFiles.map(f => f.name);
                const response = await oxyServices.uploadFiles(
                    selectedFiles, 
                    filenames, 
                    {
                        userId: targetUserId,
                        uploadDate: new Date().toISOString(),
                    }
                );

                toast.success(`${response.files.length} file(s) uploaded successfully`);
                console.log('Upload response:', response);
                console.log('Reloading files...');
                // Small delay to ensure backend processing is complete
                setTimeout(async () => {
                    await loadFiles();
                }, 500);
            } else {
                // Option 2: Individual uploads for better progress and error handling
                let successCount = 0;
                let failureCount = 0;
                const errors: string[] = [];

                for (let i = 0; i < selectedFiles.length; i++) {
                    const file = selectedFiles[i];
                    setUploadProgress({ current: i + 1, total: selectedFiles.length });

                    try {
                        await oxyServices.uploadFile(file, file.name, {
                            userId: targetUserId,
                            uploadDate: new Date().toISOString(),
                        });
                        successCount++;
                    } catch (error: any) {
                        failureCount++;
                        errors.push(`${file.name}: ${error.message || 'Upload failed'}`);
                    }
                }

                // Show results summary
                if (successCount > 0) {
                    toast.success(`${successCount} file(s) uploaded successfully`);
                }
                
                if (failureCount > 0) {
                    const errorMessage = `${failureCount} file(s) failed to upload${errors.length > 0 ? ':\n' + errors.slice(0, 3).join('\n') + (errors.length > 3 ? '\n...' : '') : ''}`;
                    toast.error(errorMessage);
                }

                // Small delay to ensure backend processing is complete
                setTimeout(async () => {
                    await loadFiles();
                }, 500);
            }
        } catch (error: any) {
            console.error('Upload error:', error);
            toast.error(error.message || 'Failed to upload files');
        } finally {
            setUploadProgress(null);
        }
    };

    const handleFileUpload = async () => {
        try {
            setUploading(true);
            setUploadProgress(null);

            if (Platform.OS === 'web') {
                // Web file picker implementation
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.accept = '*/*';
                
                input.onchange = async (e: any) => {
                    const selectedFiles = Array.from(e.target.files) as File[];
                    await processFileUploads(selectedFiles);
                };

                input.click();
            } else {
                // Mobile - show info that file picker can be added
                const installCommand = 'npm install expo-document-picker';
                const message = `Mobile File Upload\n\nTo enable file uploads on mobile, install expo-document-picker:\n\n${installCommand}\n\nThen import and use DocumentPicker.getDocumentAsync() in this method.`;
                
                if (window.confirm(`${message}\n\nWould you like to copy the install command?`)) {
                    toast.info(`Install: ${installCommand}`);
                } else {
                    toast.info('Mobile file upload requires expo-document-picker');
                }
            }
        } catch (error: any) {
            toast.error(error.message || 'Failed to upload file');
        } finally {
            setUploading(false);
            setUploadProgress(null);
        }
    };

    const handleFileDelete = async (fileId: string, filename: string) => {
        // Use web-compatible confirmation dialog
        const confirmed = window.confirm(`Are you sure you want to delete "${filename}"? This action cannot be undone.`);
        
        if (!confirmed) {
            console.log('Delete cancelled by user');
            return;
        }

        try {
            console.log('Deleting file:', { fileId, filename });
            console.log('Target user ID:', targetUserId);
            console.log('Current user ID:', user?.id);
            setDeleting(fileId);
            
            const result = await oxyServices.deleteFile(fileId);
            console.log('Delete result:', result);
            
            toast.success('File deleted successfully');
            
            // Reload files after successful deletion
            setTimeout(async () => {
                await loadFiles();
            }, 500);
        } catch (error: any) {
            console.error('Delete error:', error);
            console.error('Error details:', error.response?.data || error.message);
            toast.error(error.message || 'Failed to delete file');
        } finally {
            setDeleting(null);
        }
    };

    // Drag and drop handlers for web
    const handleDragOver = (e: any) => {
        if (Platform.OS === 'web' && user?.id === targetUserId) {
            e.preventDefault();
            setIsDragging(true);
        }
    };

    const handleDragLeave = (e: any) => {
        if (Platform.OS === 'web') {
            e.preventDefault();
            setIsDragging(false);
        }
    };

    const handleDrop = async (e: any) => {
        if (Platform.OS === 'web' && user?.id === targetUserId) {
            e.preventDefault();
            setIsDragging(false);
            setUploading(true);

            try {
                const files = Array.from(e.dataTransfer.files) as File[];
                await processFileUploads(files);
            } catch (error: any) {
                toast.error(error.message || 'Failed to upload files');
            } finally {
                setUploading(false);
            }
        }
    };

    const handleFileDownload = async (fileId: string, filename: string) => {
        try {
            if (Platform.OS === 'web') {
                console.log('Downloading file:', { fileId, filename });
                
                // Use the public download URL method
                const downloadUrl = oxyServices.getFileDownloadUrl(fileId);
                console.log('Download URL:', downloadUrl);
                
                try {
                    // Method 1: Try simple link download first
                    const link = document.createElement('a');
                    link.href = downloadUrl;
                    link.download = filename;
                    link.target = '_blank';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    
                    toast.success('File download started');
                } catch (linkError) {
                    console.warn('Link download failed, trying fetch method:', linkError);
                    
                    // Method 2: Fallback to fetch download
                    const response = await fetch(downloadUrl);
                    if (!response.ok) {
                        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
                    }
                    
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    
                    // Clean up the blob URL
                    window.URL.revokeObjectURL(url);
                    
                    toast.success('File downloaded successfully');
                }
            } else {
                toast.info('File download not implemented for mobile yet');
            }
        } catch (error: any) {
            console.error('Download error:', error);
            toast.error(error.message || 'Failed to download file');
        }
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const getFileIcon = (contentType: string): string => {
        if (contentType.startsWith('image/')) return 'image';
        if (contentType.startsWith('video/')) return 'videocam';
        if (contentType.startsWith('audio/')) return 'musical-notes';
        if (contentType.includes('pdf')) return 'document-text';
        if (contentType.includes('word') || contentType.includes('doc')) return 'document';
        if (contentType.includes('excel') || contentType.includes('sheet')) return 'grid';
        if (contentType.includes('zip') || contentType.includes('archive')) return 'archive';
        return 'document-outline';
    };

    const showFileDetailsModal = (file: FileMetadata) => {
        setSelectedFile(file);
        setShowFileDetails(true);
    };

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    const renderFileItem = (file: FileMetadata) => {
        return (
            <View
                key={file.id}
                style={[styles.fileItem, { backgroundColor: secondaryBackgroundColor, borderColor }]}
            >
                <TouchableOpacity
                    style={styles.fileContent}
                    onPress={() => showFileDetailsModal(file)}
                >
                    <View style={styles.fileIconContainer}>
                        <Ionicons
                            name={getFileIcon(file.contentType) as any}
                            size={32}
                            color={primaryColor}
                        />
                    </View>
                    
                    <View style={styles.fileInfo}>
                        <Text style={[styles.fileName, { color: textColor }]} numberOfLines={1}>
                            {file.filename}
                        </Text>
                        <Text style={[styles.fileDetails, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {formatFileSize(file.length)} • {new Date(file.uploadDate).toLocaleDateString()}
                        </Text>
                        {file.metadata?.description && (
                            <Text
                                style={[styles.fileDescription, { color: isDarkTheme ? '#AAAAAA' : '#888888' }]}
                                numberOfLines={2}
                            >
                                {file.metadata.description}
                            </Text>
                        )}
                    </View>
                </TouchableOpacity>

                <View style={styles.fileActions}>
                    <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: isDarkTheme ? '#333333' : '#F0F0F0' }]}
                        onPress={() => handleFileDownload(file.id, file.filename)}
                    >
                        <Ionicons name="download" size={20} color={primaryColor} />
                    </TouchableOpacity>

                    {/* Always show delete button for debugging */}
                    <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: isDarkTheme ? '#400000' : '#FFEBEE' }]}
                        onPress={() => {
                            handleFileDelete(file.id, file.filename);
                        }}
                        disabled={deleting === file.id}
                    >
                        {deleting === file.id ? (
                            <ActivityIndicator size="small" color={dangerColor} />
                        ) : (
                            <Ionicons name="trash" size={20} color={dangerColor} />
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const renderFileDetailsModal = () => (
        <Modal
            visible={showFileDetails}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => setShowFileDetails(false)}
        >
            <View style={[styles.modalContainer, { backgroundColor }]}>
                <View style={[styles.modalHeader, { borderBottomColor: borderColor }]}>
                    <TouchableOpacity
                        style={styles.modalCloseButton}
                        onPress={() => setShowFileDetails(false)}
                    >
                        <Ionicons name="close" size={24} color={textColor} />
                    </TouchableOpacity>
                    <Text style={[styles.modalTitle, { color: textColor }]}>File Details</Text>
                    <View style={styles.modalPlaceholder} />
                </View>

                {selectedFile && (
                    <ScrollView style={styles.modalContent}>
                        <View style={[styles.fileDetailCard, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
                            <View style={styles.fileDetailIcon}>
                                <Ionicons
                                    name={getFileIcon(selectedFile.contentType) as any}
                                    size={64}
                                    color={primaryColor}
                                />
                            </View>

                            <Text style={[styles.fileDetailName, { color: textColor }]}>
                                {selectedFile.filename}
                            </Text>

                            <View style={styles.fileDetailInfo}>
                                <View style={styles.detailRow}>
                                    <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        Size:
                                    </Text>
                                    <Text style={[styles.detailValue, { color: textColor }]}>
                                        {formatFileSize(selectedFile.length)}
                                    </Text>
                                </View>

                                <View style={styles.detailRow}>
                                    <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        Type:
                                    </Text>
                                    <Text style={[styles.detailValue, { color: textColor }]}>
                                        {selectedFile.contentType}
                                    </Text>
                                </View>

                                <View style={styles.detailRow}>
                                    <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        Uploaded:
                                    </Text>
                                    <Text style={[styles.detailValue, { color: textColor }]}>
                                        {new Date(selectedFile.uploadDate).toLocaleString()}
                                    </Text>
                                </View>

                                {selectedFile.metadata?.description && (
                                    <View style={styles.detailRow}>
                                        <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                            Description:
                                        </Text>
                                        <Text style={[styles.detailValue, { color: textColor }]}>
                                            {selectedFile.metadata.description}
                                        </Text>
                                    </View>
                                )}
                            </View>

                            <View style={styles.modalActions}>
                                <TouchableOpacity
                                    style={[styles.modalActionButton, { backgroundColor: primaryColor }]}
                                    onPress={() => {
                                        handleFileDownload(selectedFile.id, selectedFile.filename);
                                        setShowFileDetails(false);
                                    }}
                                >
                                    <Ionicons name="download" size={20} color="#FFFFFF" />
                                    <Text style={styles.modalActionText}>Download</Text>
                                </TouchableOpacity>

                                {(user?.id === targetUserId) && (
                                    <TouchableOpacity
                                        style={[styles.modalActionButton, { backgroundColor: dangerColor }]}
                                        onPress={() => {
                                            setShowFileDetails(false);
                                            handleFileDelete(selectedFile.id, selectedFile.filename);
                                        }}
                                    >
                                        <Ionicons name="trash" size={20} color="#FFFFFF" />
                                        <Text style={styles.modalActionText}>Delete</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    </ScrollView>
                )}
            </View>
        </Modal>
    );

    const renderEmptyState = () => (
        <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={64} color={isDarkTheme ? '#666666' : '#CCCCCC'} />
            <Text style={[styles.emptyStateTitle, { color: textColor }]}>No Files Yet</Text>
            <Text style={[styles.emptyStateDescription, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                {user?.id === targetUserId 
                    ? `Upload files to get started. You can select multiple files at once${Platform.OS === 'web' ? ' or drag & drop them here.' : '.'}`
                    : "This user hasn't uploaded any files yet"
                }
            </Text>
            {user?.id === targetUserId && (
                <TouchableOpacity
                    style={[styles.emptyStateButton, { backgroundColor: primaryColor }]}
                    onPress={handleFileUpload}
                    disabled={uploading}
                >
                    {uploading ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                        <>
                            <Ionicons name="cloud-upload" size={20} color="#FFFFFF" />
                            <Text style={styles.emptyStateButtonText}>Upload Files</Text>
                        </>
                    )}
                </TouchableOpacity>
            )}
        </View>
    );

    if (loading) {
        return (
            <View style={[styles.container, styles.centerContent, { backgroundColor }]}>
                <ActivityIndicator size="large" color={primaryColor} />
                <Text style={[styles.loadingText, { color: textColor }]}>Loading files...</Text>
            </View>
        );
    }

    return (
        <View 
            style={[
                styles.container, 
                { backgroundColor },
                isDragging && Platform.OS === 'web' && styles.dragOverlay
            ]}
            {...(Platform.OS === 'web' && user?.id === targetUserId ? {
                onDragOver: handleDragOver,
                onDragLeave: handleDragLeave,
                onDrop: handleDrop,
            } : {})}
        >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: borderColor }]}>
                <TouchableOpacity style={styles.backButton} onPress={onClose || goBack}>
                    <Ionicons name="arrow-back" size={24} color={textColor} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: textColor }]}>File Management</Text>
                {user?.id === targetUserId && (
                    <TouchableOpacity
                        style={[styles.uploadButton, { backgroundColor: primaryColor }]}
                        onPress={handleFileUpload}
                        disabled={uploading}
                    >
                        {uploading ? (
                            <View style={styles.uploadProgress}>
                                <ActivityIndicator size="small" color="#FFFFFF" />
                                {uploadProgress && (
                                    <Text style={styles.uploadProgressText}>
                                        {uploadProgress.current}/{uploadProgress.total}
                                    </Text>
                                )}
                            </View>
                        ) : (
                            <Ionicons name="add" size={24} color="#FFFFFF" />
                        )}
                    </TouchableOpacity>
                )}
            </View>

            {/* Search Bar */}
            {files.length > 0 && (
                <View style={[styles.searchContainer, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
                    <Ionicons name="search" size={20} color={isDarkTheme ? '#888888' : '#666666'} />
                    <TextInput
                        style={[styles.searchInput, { color: textColor }]}
                        placeholder="Search files..."
                        placeholderTextColor={isDarkTheme ? '#888888' : '#999999'}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={20} color={isDarkTheme ? '#888888' : '#666666'} />
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {/* File Stats */}
            {files.length > 0 && (
                <View style={[styles.statsContainer, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
                    <View style={styles.statItem}>
                        <Text style={[styles.statValue, { color: textColor }]}>{filteredFiles.length}</Text>
                        <Text style={[styles.statLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {searchQuery.length > 0 ? 'Found' : (filteredFiles.length === 1 ? 'File' : 'Files')}
                        </Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={[styles.statValue, { color: textColor }]}>
                            {formatFileSize(filteredFiles.reduce((total, file) => total + file.length, 0))}
                        </Text>
                        <Text style={[styles.statLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {searchQuery.length > 0 ? 'Size' : 'Total Size'}
                        </Text>
                    </View>
                    {searchQuery.length > 0 && (
                        <View style={styles.statItem}>
                            <Text style={[styles.statValue, { color: textColor }]}>{files.length}</Text>
                            <Text style={[styles.statLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                Total
                            </Text>
                        </View>
                    )}
                </View>
            )}

            {/* File List */}
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContainer}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => loadFiles(true)}
                        tintColor={primaryColor}
                    />
                }
            >
                {filteredFiles.length === 0 && searchQuery.length > 0 ? (
                    <View style={styles.emptyState}>
                        <Ionicons name="search" size={64} color={isDarkTheme ? '#666666' : '#CCCCCC'} />
                        <Text style={[styles.emptyStateTitle, { color: textColor }]}>No Results Found</Text>
                        <Text style={[styles.emptyStateDescription, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            No files match your search for "{searchQuery}"
                        </Text>
                        <TouchableOpacity
                            style={[styles.emptyStateButton, { backgroundColor: primaryColor }]}
                            onPress={() => setSearchQuery('')}
                        >
                            <Ionicons name="refresh" size={20} color="#FFFFFF" />
                            <Text style={styles.emptyStateButtonText}>Clear Search</Text>
                        </TouchableOpacity>
                    </View>
                ) : filteredFiles.length === 0 ? renderEmptyState() : (
                    <>
                        {filteredFiles.map(renderFileItem)}
                    </>
                )}
            </ScrollView>

            {renderFileDetailsModal()}

            {/* Drag and Drop Overlay */}
            {isDragging && Platform.OS === 'web' && (
                <View style={styles.dragDropOverlay}>
                    <View style={styles.dragDropContent}>
                        <Ionicons name="cloud-upload" size={64} color={primaryColor} />
                        <Text style={[styles.dragDropTitle, { color: primaryColor }]}>
                            Drop files to upload
                        </Text>
                        <Text style={[styles.dragDropSubtitle, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            Release to upload{uploadProgress ? ` (${uploadProgress.current}/${uploadProgress.total})` : ' multiple files'}
                        </Text>
                    </View>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    dragOverlay: {
        backgroundColor: 'rgba(0, 122, 255, 0.1)',
        borderWidth: 2,
        borderColor: '#007AFF',
        borderStyle: 'dashed',
    },
    centerContent: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    backButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        flex: 1,
        textAlign: 'center',
    },
    uploadButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    uploadProgress: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    uploadProgressText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '600',
        marginTop: 2,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginHorizontal: 20,
        marginTop: 16,
        borderRadius: 12,
        borderWidth: 1,
        gap: 12,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        paddingVertical: 4,
    },
    searchIcon: {
        marginRight: 8,
    },
    statsContainer: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        paddingVertical: 16,
        marginHorizontal: 20,
        marginTop: 16,
        borderRadius: 12,
        borderWidth: 1,
    },
    statItem: {
        flex: 1,
        alignItems: 'center',
    },
    statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        fontFamily: fontFamilies.phuduBold,
    },
    statLabel: {
        fontSize: 14,
        marginTop: 4,
    },
    scrollView: {
        flex: 1,
    },
    scrollContainer: {
        padding: 20,
    },
    fileItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginBottom: 12,
        borderRadius: 12,
        borderWidth: 1,
    },
    fileContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    fileIconContainer: {
        width: 50,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    fileInfo: {
        flex: 1,
    },
    fileName: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    fileDetails: {
        fontSize: 14,
        marginBottom: 2,
    },
    fileDescription: {
        fontSize: 12,
        fontStyle: 'italic',
    },
    fileActions: {
        flexDirection: 'row',
        gap: 8,
    },
    actionButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 60,
        paddingHorizontal: 40,
    },
    emptyStateTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        fontFamily: fontFamilies.phuduBold,
        marginTop: 16,
        marginBottom: 8,
    },
    emptyStateDescription: {
        fontSize: 16,
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 32,
    },
    emptyStateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 24,
        gap: 8,
    },
    emptyStateButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    loadingText: {
        fontSize: 16,
        marginTop: 16,
    },
    
    // Modal styles
    modalContainer: {
        flex: 1,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    modalCloseButton: {
        padding: 8,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    modalPlaceholder: {
        width: 40,
    },
    modalContent: {
        flex: 1,
        padding: 20,
    },
    fileDetailCard: {
        padding: 24,
        borderRadius: 16,
        borderWidth: 1,
        alignItems: 'center',
    },
    fileDetailIcon: {
        marginBottom: 16,
    },
    fileDetailName: {
        fontSize: 20,
        fontWeight: 'bold',
        fontFamily: fontFamilies.phuduBold,
        textAlign: 'center',
        marginBottom: 24,
    },
    fileDetailInfo: {
        width: '100%',
        marginBottom: 32,
    },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
        flexWrap: 'wrap',
    },
    detailLabel: {
        fontSize: 16,
        fontWeight: '500',
        flex: 1,
        minWidth: 100,
    },
    detailValue: {
        fontSize: 16,
        flex: 2,
        textAlign: 'right',
    },
    modalActions: {
        flexDirection: 'row',
        gap: 12,
        width: '100%',
    },
    modalActionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        borderRadius: 12,
        gap: 8,
    },
    modalActionText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    
    // Drag and Drop styles
    dragDropOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
    },
    dragDropContent: {
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        padding: 40,
        borderRadius: 20,
        borderWidth: 3,
        borderColor: '#007AFF',
        borderStyle: 'dashed',
    },
    dragDropTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginTop: 16,
        marginBottom: 8,
    },
    dragDropSubtitle: {
        fontSize: 16,
        textAlign: 'center',
    },
});

export default FileManagementScreen;
