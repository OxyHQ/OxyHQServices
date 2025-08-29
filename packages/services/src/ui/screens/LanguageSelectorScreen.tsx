import type React from 'react';
import { useState } from 'react';
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
import { Header, GroupedSection } from '../components';
import { useI18n } from '../hooks/useI18n';

// Supported languages with their metadata
const SUPPORTED_LANGUAGES = [
    {
        id: 'en-US',
        name: 'English',
        nativeName: 'English',
        flag: '🇺🇸',
        icon: 'language-outline',
        color: '#007AFF',
    },
    {
        id: 'es-ES',
        name: 'Spanish',
        nativeName: 'Español',
        flag: '🇪🇸',
        icon: 'language-outline',
        color: '#FF3B30',
    },
    {
        id: 'ca-ES',
        name: 'Catalan',
        nativeName: 'Català',
        flag: '🇪🇸',
        icon: 'language-outline',
        color: '#0CA678',
    },
    {
        id: 'fr-FR',
        name: 'French',
        nativeName: 'Français',
        flag: '🇫🇷',
        icon: 'language-outline',
        color: '#5856D6',
    },
    {
        id: 'de-DE',
        name: 'German',
        nativeName: 'Deutsch',
        flag: '🇩🇪',
        icon: 'language-outline',
        color: '#FF9500',
    },
    {
        id: 'it-IT',
        name: 'Italian',
        nativeName: 'Italiano',
        flag: '🇮🇹',
        icon: 'language-outline',
        color: '#34C759',
    },
    {
        id: 'pt-PT',
        name: 'Portuguese',
        nativeName: 'Português',
        flag: '🇵🇹',
        icon: 'language-outline',
        color: '#AF52DE',
    },
    {
        id: 'ja-JP',
        name: 'Japanese',
        nativeName: '日本語',
        flag: '🇯🇵',
        icon: 'language-outline',
        color: '#FF2D92',
    },
    {
        id: 'ko-KR',
        name: 'Korean',
        nativeName: '한국어',
        flag: '🇰🇷',
        icon: 'language-outline',
        color: '#32D74B',
    },
    {
        id: 'zh-CN',
        name: 'Chinese',
        nativeName: '中文',
        flag: '🇨🇳',
        icon: 'language-outline',
        color: '#FF9F0A',
    },
    {
        id: 'ar-SA',
        name: 'Arabic',
        nativeName: 'العربية',
        flag: '🇸🇦',
        icon: 'language-outline',
        color: '#30B0C7',
    },
];

interface LanguageSelectorScreenProps extends BaseScreenProps { }

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

    const handleLanguageSelect = async (languageId: string) => {
        if (languageId === currentLanguage) {
            return; // Already selected
        }

        setIsLoading(true);

        try {
            // If signed in, persist preference to backend user settings
            if (isAuthenticated && user?.id) {
                try {
                    await oxyServices.updateProfile({ language: languageId });
                } catch (e: any) {
                    console.warn('Failed to update language on server, falling back to local storage', e);
                }
            }

            // Always persist locally for immediate UX and for guests
            await setLanguage(languageId);

            const selectedLang = SUPPORTED_LANGUAGES.find(lang => lang.id === languageId);
            toast.success(t('language.changed', { lang: selectedLang?.name || languageId }));

            setIsLoading(false);
            // Close the bottom sheet if possible; otherwise, go back
            if (onClose) onClose(); else goBack();

        } catch (error) {
            console.error('Error saving language preference:', error);
            toast.error('Failed to save language preference');
            setIsLoading(false);
        }
    };

    // Create grouped items for the language list
    const languageItems = SUPPORTED_LANGUAGES.map(language => ({
        id: language.id,
        title: language.name,
        subtitle: language.nativeName,
        icon: language.icon,
        iconColor: language.color,
        selected: currentLanguage === language.id,
        onPress: () => handleLanguageSelect(language.id),
        customContent: (
            <View style={styles.languageFlag}>
                <Text style={styles.flagEmoji}>{language.flag}</Text>
            </View>
        ),
    }));

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <Header
                title={t('language.title')}
                subtitle={t('language.subtitle')}
                theme={theme}
                onBack={onClose || goBack}
                elevation="subtle"
            />

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Current selection indicator moved to top */}
                {currentLanguage && (
                    <View style={styles.currentSection}>
                        <Text style={[styles.currentLabel, { color: colors.secondaryText }]}>
                            {t('language.current')}
                        </Text>
                        <View style={[styles.currentLanguage, {
                            backgroundColor: colors.inputBackground,
                            borderColor: colors.primary
                        }]}>
                            {(() => {
                                const current = SUPPORTED_LANGUAGES.find(lang => lang.id === currentLanguage);
                                return current ? (
                                    <>
                                        <Text style={styles.currentFlag}>{current.flag}</Text>
                                        <View style={styles.currentInfo}>
                                            <Text style={[styles.currentName, { color: colors.text }]}>
                                                {current.name}
                                            </Text>
                                            <Text style={[styles.currentNative, { color: colors.secondaryText }]}>
                                                {current.nativeName}
                                            </Text>
                                        </View>
                                        <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                                    </>
                                ) : null;
                            })()}
                        </View>
                    </View>
                )}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>
                        {t('language.available')}
                    </Text>
                    <Text style={[styles.sectionDescription, { color: colors.secondaryText }]}>
                        {t('language.subtitle')}
                    </Text>

                    <View style={styles.languageList}>
                        <GroupedSection
                            items={languageItems}
                            theme={theme}
                        />
                    </View>
                </View>

                {/* Information section */}
                <View style={styles.infoSection}>
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
                </View>

                {/* Current selection indicator moved above */}
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
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    flagEmoji: {
        fontSize: 24,
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
        fontSize: 24,
        marginRight: 12,
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

export default LanguageSelectorScreen;
