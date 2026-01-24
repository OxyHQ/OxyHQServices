import React, { useState, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Platform,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/use-color-scheme';
import { normalizeTheme } from '../utils/themeUtils';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../lib/sonner';
import { Header, GroupedSection } from '../components';
import { useI18n } from '../hooks/useI18n';
import { SUPPORTED_LANGUAGES } from '../../utils/languageUtils';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';

interface LanguageSelectorScreenProps extends BaseScreenProps { }

/**
 * LanguageSelectorScreen - Optimized for performance
 * 
 * Performance optimizations:
 * - useMemo for language items to prevent recreation on every render
 * - useCallback for handlers to prevent unnecessary re-renders
 * - Memoized current language section
 */
const LanguageSelectorScreen: React.FC<LanguageSelectorScreenProps> = ({
    goBack,
    onClose,
    theme,
}) => {
    // Use useOxy() hook for OxyContext values
    const { user, currentLanguage, setLanguage, oxyServices, isAuthenticated } = useOxy();
    const { t } = useI18n();
    const colorScheme = useColorScheme();
    const normalizedTheme = normalizeTheme(theme);
    const themeStyles = useThemeStyles(normalizedTheme, colorScheme);
    const themeColors = themeStyles.colors;
    const [isLoading, setIsLoading] = useState(false);

    // Memoize the language select handler to prevent recreation on every render
    const handleLanguageSelect = useCallback(async (languageId: string) => {
        if (languageId === currentLanguage || isLoading) {
            return; // Already selected or loading
        }

        setIsLoading(true);

        try {
            let serverSyncFailed = false;

            // If signed in, persist preference to backend user settings
            if (isAuthenticated && user?.id) {
                try {
                    await oxyServices.updateProfile({ language: languageId });
                } catch (e: any) {
                    // Server sync failed, but we'll save locally anyway
                    serverSyncFailed = true;
                    if (__DEV__) {
                        console.warn('Failed to sync language to server (will save locally only):', e?.message || e);
                    }
                }
            }

            // Always persist locally for immediate UX and for guests
            await setLanguage(languageId);

            const selectedLang = SUPPORTED_LANGUAGES.find(lang => lang.id === languageId);

            // Show success message (language is saved locally regardless of server sync)
            toast.success(t('language.changed', { lang: selectedLang?.name || languageId }));

            // Log server sync failure only in dev mode (user experience is still good - saved locally)
            if (serverSyncFailed && __DEV__) {
                console.warn('Language saved locally but server sync failed');
            }

            setIsLoading(false);
            // Close the bottom sheet if possible; otherwise, go back
            if (onClose) onClose(); else goBack?.();

        } catch (error) {
            // Only show error if local storage also failed
            if (__DEV__) {
                console.error('Error saving language preference:', error);
            }
            toast.error('Failed to save language preference');
            setIsLoading(false);
        }
    }, [currentLanguage, isLoading, isAuthenticated, user?.id, oxyServices, setLanguage, t, onClose, goBack]);

    // Memoize language items to prevent recreation on every render
    const languageItems = useMemo(() =>
        SUPPORTED_LANGUAGES.map(language => {
            const isSelected = currentLanguage === language.id;
            return {
                id: language.id,
                title: language.name,
                subtitle: language.nativeName,
                customIcon: (
                    <View style={[styles.languageFlag, { backgroundColor: `${language.color}15` }]}>
                        <Text style={styles.flagEmoji}>{language.flag}</Text>
                    </View>
                ),
                iconColor: language.color,
                selected: isSelected,
                onPress: () => handleLanguageSelect(language.id),
                customContent: isSelected ? (
                    <Ionicons name="checkmark-circle" size={24} color={themeColors.tint} />
                ) : undefined,
            };
        }),
        [currentLanguage, handleLanguageSelect, themeColors]
    );


    return (
        <View style={[styles.container, { backgroundColor: theme === 'dark' ? '#000000' : '#F5F5F5' }]}>
            <Header
                title=""
                subtitle=""
                theme={normalizedTheme}
                onBack={onClose || goBack}
                variant="minimal"
                elevation="none"
            />

            <ScrollView
                style={styles.content}
                contentContainerStyle={styles.contentContainer}
                showsVerticalScrollIndicator={false}
                removeClippedSubviews={true}
            >
                {/* Big Title */}
                <View style={styles.titleContainer}>
                    <Text style={[styles.bigTitle, { color: themeColors.text }]}>
                        {t('language.title')}
                    </Text>
                    {t('language.subtitle') && (
                        <Text style={[styles.bigSubtitle, { color: themeColors.secondaryText }]}>
                            {t('language.subtitle')}
                        </Text>
                    )}
                </View>

                {/* Available languages - Main section */}
                <View style={styles.sectionContainer}>
                    <View style={[styles.materialCard, {
                        backgroundColor: themeColors.card,
                    }]}>
                        <GroupedSection items={languageItems} />
                    </View>
                </View>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
    },
    contentContainer: {
        padding: 16,
        paddingTop: 24,
    },
    titleContainer: {
        marginBottom: 32,
        paddingTop: 0,
    },
    bigTitle: {
        fontSize: 34,
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontFamily: fontFamilies.phuduBold,
        lineHeight: 40,
        marginBottom: 8,
        letterSpacing: -0.5,
    },
    bigSubtitle: {
        fontSize: 16,
        lineHeight: 22,
        opacity: 0.7,
        marginTop: 4,
    },
    sectionContainer: {
        marginBottom: 8,
    },
    materialCard: {
        borderRadius: 12,
        overflow: 'hidden',
    },
    languageFlag: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    flagEmoji: {
        fontSize: 20,
    },
});

// Export memoized component to prevent unnecessary re-renders
export default React.memo(LanguageSelectorScreen);
