import type React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface UploadBarProps {
    /** Aggregate upload progress, or null when indeterminate. */
    uploadProgress: { current: number; total: number } | null;
    /** Bloom dark-mode flag (drives banner + track colors). */
    isDark: boolean;
    /** Theme colors used by the banner. */
    colors: { primary: string; text: string; border: string };
    t: (key: string, vars?: Record<string, string | number>) => string;
}

// The banner drop-shadow has no Bloom/Tailwind token equivalent, so it stays an
// inline style (genuinely-required exception).
const shadowStyle = StyleSheet.create({
    banner: {
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
    },
});

/**
 * The non-blocking "Uploading…" banner overlay shown at the bottom of the file
 * manager while uploads are in flight. Purely presentational — the orchestrator
 * gates rendering on `!selectMode && uploading`.
 */
const UploadBar: React.FC<UploadBarProps> = ({ uploadProgress, isDark, colors, t }) => (
    <View pointerEvents="none" className="absolute top-[72px] left-0 right-0 items-center z-50">
        <View
            className="flex-row items-center px-3.5 py-2.5 rounded-[24px] gap-2.5 border min-w-[200px]"
            style={[shadowStyle.banner, { backgroundColor: isDark ? '#222831EE' : '#FFFFFFEE', borderColor: colors.border }]}
        >
            <Ionicons name="cloud-upload" size={18} color={colors.primary} />
            <View className="flex-1 gap-1.5">
                <Text className="text-[13px] font-medium" style={{ color: colors.text }}>
                    {t('fileManagement.uploading')}{uploadProgress ? ` ${uploadProgress.current}/${uploadProgress.total}` : '...'}
                </Text>
                {uploadProgress && uploadProgress.total > 0 && (
                    <View
                        className="h-[3px] rounded-[2px] overflow-hidden"
                        style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
                    >
                        <View
                            className="h-full rounded-[2px]"
                            style={{
                                width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                                backgroundColor: colors.primary,
                            }}
                        />
                    </View>
                )}
            </View>
            <ActivityIndicator size="small" color={colors.primary} />
        </View>
    </View>
);

export default UploadBar;
