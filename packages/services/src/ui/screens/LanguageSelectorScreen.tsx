import React, { useState, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Alert,
} from 'react-native';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { useThemeColors } from '../styles';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../lib/sonner';
import { Header, Section, GroupedSection } from '../components';
import { useI18n } from '../hooks/useI18n';
import { SUPPORTED_LANGUAGES } from '../../utils/languageUtils';

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
    navigate,
}) => {
    const { user, currentLanguage, setLanguage, oxyServices, isAuthenticated } = useOxy();
    const { t } = useI18n();
    const colors = useThemeColors(theme);
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
            if (onClose) onClose(); else goBack();

        } catch (error) {
            // Only show error if local storage also failed
            console.error('Error saving language preference:', error);
            toast.error('Failed to save language preference');
            setIsLoading(false);
        }
    }, [currentLanguage, isLoading, isAuthenticated, user?.id, oxyServices, setLanguage, t, onClose, goBack]);

    // Memoize language items to prevent recreation on every render
    const languageItems = useMemo(() => 
        SUPPORTED_LANGUAGES.map(language => ({
            id: language.id,
            title: language.name,
            subtitle: language.nativeName,
            customIcon: (
                <View style={[styles.languageFlag, { backgroundColor: `${language.color}20` }]}>
                    <Text style={styles.flagEmoji}>{language.flag}</Text>
                </View>
            ),
            iconColor: language.color,
            selected: currentLanguage === language.id,
            onPress: () => handleLanguageSelect(language.id),
            dense: true,
        })), 
        [currentLanguage, handleLanguageSelect]
    );

    // Memoize current language data to prevent recalculation
    const currentLanguageData = useMemo(() => {
        if (!currentLanguage) return null;
        return SUPPORTED_LANGUAGES.find(lang => lang.id === currentLanguage);
    }, [currentLanguage]);

    // Memoize current language section items
    const currentLanguageItems = useMemo(() => {
        if (!currentLanguageData) return [];
        return [{
            id: `current-${currentLanguageData.id}`,
            title: currentLanguageData.name,
            subtitle: currentLanguageData.nativeName,
            customIcon: (
                <View style={[styles.languageFlag, { backgroundColor: `${currentLanguageData.color}20` }]}>
                    <Text style={styles.flagEmoji}>{currentLanguageData.flag}</Text>
                </View>
            ),
            iconColor: currentLanguageData.color,
            selected: false,
            showChevron: false,
            dense: true,
            disabled: true,
        }];
    }, [currentLanguageData]);

    return (
        <View style={[styles.container, { backgroundColor: '#f2f2f2' }]}>
            <Header
                title={t('language.title')}
                subtitle={t('language.subtitle')}
                
                onBack={onClose || goBack}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView 
                style={styles.content} 
                showsVerticalScrollIndicator={false}
                removeClippedSubviews={true}
            >
                {/* Current selection */}
                {currentLanguage && currentLanguageItems.length > 0 && (
                    <Section title={t('language.current')}  isFirst={true}>
                        <GroupedSection
                            items={currentLanguageItems}
                            
                        />
                    </Section>
                )}

                {/* Available languages */}
                <Section title={t('language.available')} >
                    <Text style={[styles.sectionDescription, { color: colors.secondaryText }]}>
                        {t('language.subtitle')}
                    </Text>
                    <View style={styles.languageList}>
                        <GroupedSection
                            items={languageItems}
                            
                        />
                    </View>
                </Section>

                {/* Information */}
                <Section >
                    <View style={[styles.infoCard, {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border
                    }]}>
                        <View style={styles.infoHeader}>
                            <Ionicons name="information-circle" size={20} color={colors.primary} />
                            <Text style={[styles.infoTitle, { color: colors.text }]}>
                                Language Settings
                            </Text>
                        </View>
                        <Text style={[styles.infoText, { color: colors.secondaryText }]}>
                            • Language changes apply immediately{'\n'}
                            • Your preference is saved automatically{'\n'}
                            • All text and interface elements will update{'\n'}
                            • You can change this setting anytime
                        </Text>
                    </View>
                </Section>
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
        padding: 16,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    sectionDescription: {
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 16,
    },
    languageList: {
        marginTop: 8,
    },
    languageFlag: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
    },
    flagEmoji: {
        fontSize: 18,
    },
    infoSection: {
        marginBottom: 24,
    },
    infoCard: {
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
    },
    infoHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    infoTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    infoText: {
        fontSize: 14,
        lineHeight: 20,
    },
    currentSection: {
        marginBottom: 24,
    },
    currentLabel: {
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 8,
    },
    currentLanguage: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        borderWidth: 2,
    },
    currentFlag: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    currentFlagEmoji: {
        fontSize: 18,
    },
    currentInfo: {
        flex: 1,
    },
    currentName: {
        fontSize: 16,
        fontWeight: '600',
    },
    currentNative: {
        fontSize: 14,
        marginTop: 2,
    },
});

// Export memoized component to prevent unnecessary re-renders
export default React.memo(LanguageSelectorScreen);
