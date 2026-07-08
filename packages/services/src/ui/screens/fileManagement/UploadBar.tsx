import type React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fileManagementStyles } from '../../components/fileManagement/styles';

export interface UploadBarProps {
    /** Aggregate upload progress, or null when indeterminate. */
    uploadProgress: { current: number; total: number } | null;
    /** Bloom dark-mode flag (drives banner + track colors). */
    isDark: boolean;
    /** Theme colors used by the banner. */
    colors: { primary: string; text: string; border: string };
    t: (key: string, vars?: Record<string, string | number>) => string;
}

/**
 * The non-blocking "Uploading…" banner overlay shown at the bottom of the file
 * manager while uploads are in flight. Purely presentational — the orchestrator
 * gates rendering on `!selectMode && uploading`.
 */
const UploadBar: React.FC<UploadBarProps> = ({ uploadProgress, isDark, colors, t }) => (
    <View style={[fileManagementStyles.uploadBannerContainer, { pointerEvents: 'none' }]}>
        <View style={[fileManagementStyles.uploadBanner, { backgroundColor: isDark ? '#222831EE' : '#FFFFFFEE', borderColor: colors.border }]}>
            <Ionicons name="cloud-upload" size={18} color={colors.primary} />
            <View style={fileManagementStyles.uploadBannerContent}>
                <Text style={[fileManagementStyles.uploadBannerText, { color: colors.text }]}>
                    {t('fileManagement.uploading')}{uploadProgress ? ` ${uploadProgress.current}/${uploadProgress.total}` : '...'}
                </Text>
                {uploadProgress && uploadProgress.total > 0 && (
                    <View style={[fileManagementStyles.uploadProgressBarContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
                        <View
                            style={[
                                fileManagementStyles.uploadProgressBar,
                                {
                                    width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                                    backgroundColor: colors.primary
                                }
                            ]}
                        />
                    </View>
                )}
            </View>
            <ActivityIndicator size="small" color={colors.primary} />
        </View>
    </View>
);

export default UploadBar;
