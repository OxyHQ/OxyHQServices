import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { useTheme } from '@oxyhq/bloom/theme';
import { normalizeTheme } from '@oxyhq/core';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '@oxyhq/bloom';
import { H1, Text } from '@oxyhq/bloom/typography';
import { SearchInput } from '@oxyhq/bloom/search-input';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import Header from '../components/Header';
import { useI18n } from '../hooks/useI18n';
import { SUPPORTED_LANGUAGES } from '@oxyhq/core';
import { useOxy } from '../context/OxyContext';

interface LanguageSelectorScreenProps extends BaseScreenProps { }

// Size (in dp) of the circular flag chip rendered as each row's leading icon.
const FLAG_CHIP_SIZE = 40;
// Selected-row check indicator size (dp).
const CHECK_ICON_SIZE = 24;

/**
 * LanguageSelectorScreen - Optimized for performance
 *
 * Performance optimizations:
 * - useMemo for the filtered language list to prevent recreation on every render
 * - useCallback for handlers to prevent unnecessary re-renders
 * - Memoized component to prevent unnecessary re-renders
 */
const LanguageSelectorScreen: React.FC<LanguageSelectorScreenProps> = ({
    goBack,
    onClose,
    theme,
}) => {
    // Use useOxy() hook for OxyContext values
    const { user, currentLanguage, setLanguage, oxyServices, isAuthenticated } = useOxy();
    const { t } = useI18n();
    const bloomTheme = useTheme();
    const normalizedTheme = normalizeTheme(theme);
    const [isLoading, setIsLoading] = useState(false);
    const [query, setQuery] = useState('');

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
                } catch (e: unknown) {
                    // Server sync failed, but we'll save locally anyway
                    serverSyncFailed = true;
                    if (__DEV__) {
                        console.warn('Failed to sync language to server (will save locally only):', e instanceof Error ? e.message : e);
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
            toast.error(t('language.saveFailed'));
            setIsLoading(false);
        }
    }, [currentLanguage, isLoading, isAuthenticated, user?.id, oxyServices, setLanguage, t, onClose, goBack]);

    // Filter the supported languages by the search query (name + native name).
    const filteredLanguages = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) {
            return SUPPORTED_LANGUAGES;
        }
        return SUPPORTED_LANGUAGES.filter((language) =>
            language.name.toLowerCase().includes(normalized) ||
            language.nativeName.toLowerCase().includes(normalized)
        );
    }, [query]);

    return (
        <View className="flex-1 bg-bg">
            <Header
                title=""
                subtitle=""
                theme={normalizedTheme}
                onBack={onClose || goBack}
                variant="minimal"
                elevation="none"
            />

            <ScrollView
                className="flex-1"
                contentContainerClassName="px-screen-margin pt-space-24 pb-space-24"
                showsVerticalScrollIndicator={false}
                removeClippedSubviews={true}
                keyboardShouldPersistTaps="handled"
            >
                {/* Big Title */}
                <View className="mb-space-16">
                    <H1 className="text-text" style={styles.bigTitle}>
                        {t('language.title')}
                    </H1>
                    {t('language.subtitle') ? (
                        <Text className="text-text-secondary mt-space-2" style={styles.bigSubtitle}>
                            {t('language.subtitle')}
                        </Text>
                    ) : null}
                </View>

                {/* Search / filter */}
                <View className="mb-space-16">
                    <SearchInput
                        value={query}
                        onChangeText={setQuery}
                        onClearText={() => setQuery('')}
                        label={t('language.search') || 'Search languages'}
                    />
                </View>

                {/* Available languages - Main section */}
                <SettingsListGroup>
                    {filteredLanguages.map((language) => {
                        const isSelected = currentLanguage === language.id;
                        return (
                            <SettingsListItem
                                key={language.id}
                                icon={
                                    <View
                                        className="bg-fill-secondary items-center justify-center"
                                        style={styles.languageFlag}
                                    >
                                        <Text style={styles.flagEmoji}>{language.flag}</Text>
                                    </View>
                                }
                                title={language.name}
                                description={language.nativeName}
                                onPress={() => handleLanguageSelect(language.id)}
                                rightElement={
                                    isSelected ? (
                                        <Ionicons
                                            name="checkmark-circle"
                                            size={CHECK_ICON_SIZE}
                                            color={bloomTheme.colors.primary}
                                        />
                                    ) : undefined
                                }
                                showChevron={false}
                            />
                        );
                    })}
                </SettingsListGroup>
            </ScrollView>
        </View>
    );
};

// StyleSheet retained ONLY for measured layout (sizes / line metrics) — no colors.
const styles = StyleSheet.create({
    bigTitle: {
        fontSize: 34,
        lineHeight: 40,
        letterSpacing: -0.5,
    },
    bigSubtitle: {
        fontSize: 16,
        lineHeight: 22,
    },
    languageFlag: {
        width: FLAG_CHIP_SIZE,
        height: FLAG_CHIP_SIZE,
        borderRadius: FLAG_CHIP_SIZE / 2,
    },
    flagEmoji: {
        fontSize: 20,
    },
});

// Export memoized component to prevent unnecessary re-renders
export default React.memo(LanguageSelectorScreen);
