import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import NotificationSection from './accountSettings/NotificationSection';
import AppearanceSection from './accountSettings/AppearanceSection';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../lib/sonner';
import { fontFamilies } from '../styles/fonts';

/**
 * AppSettingsScreen – contains application-level preferences that are not tied directly to the user profile.
 * Currently this includes Notifications and Appearance.  More categories can be added later without touching
 * the account settings flow.
 */
const AppSettingsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    goBack,
    navigate,
    theme,
}) => {
    const {
        settings,
        settingsLoading,
        loadSettings,
        saveSettings,
        ensureToken,
    } = useOxy();

    const [isRefreshing, setIsRefreshing] = useState(false);

    // Local UI state derived from settings
    const [pushNotifications, setPushNotifications] = useState(true);
    const [emailNotifications, setEmailNotifications] = useState(true);
    const [marketingEmails, setMarketingEmails] = useState(false);
    const [soundEnabled, setSoundEnabled] = useState(true);

    const [currentTheme, setCurrentTheme] = useState<'light' | 'dark' | 'auto'>('auto');
    const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('medium');
    const [language, setLanguage] = useState<string>('English');

    // Load settings on mount if we don't have them yet
    useEffect(() => {
        if (!settings) {
            (async () => {
                setIsRefreshing(true);
                try {
                    await loadSettings();
                } catch (err) {
                    toast.error('Failed to load settings');
                } finally {
                    setIsRefreshing(false);
                }
            })();
        }
    }, [settings, loadSettings]);

    // Keep local state in sync with settings
    useEffect(() => {
        if (settings) {
            setPushNotifications(settings.pushNotifications !== false);
            setEmailNotifications(settings.emailNotifications !== false);
            setMarketingEmails(!!settings.marketingEmails);
            setSoundEnabled(settings.soundEnabled !== false);
            setCurrentTheme((settings as any).theme || 'auto');
            setFontSize((settings as any).fontSize || 'medium');
            setLanguage((settings as any).language || 'English');
        }
    }, [settings]);

    /* --------------------------- Notification handlers --------------------------- */
    const handleTogglePushNotifications = async (value: boolean) => {
        setPushNotifications(value);
        try {
            await ensureToken();
            await saveSettings({ pushNotifications: value });
        } catch {
            toast.error('Failed to update notification settings');
        }
    };

    const handleToggleEmailNotifications = async (value: boolean) => {
        setEmailNotifications(value);
        try {
            await ensureToken();
            await saveSettings({ emailNotifications: value });
        } catch {
            toast.error('Failed to update notification settings');
        }
    };

    const handleToggleMarketingEmails = async (value: boolean) => {
        setMarketingEmails(value);
        try {
            await ensureToken();
            await saveSettings({ marketingEmails: value });
        } catch {
            toast.error('Failed to update notification settings');
        }
    };

    const handleToggleSound = async (value: boolean) => {
        setSoundEnabled(value);
        try {
            await ensureToken();
            await saveSettings({ soundEnabled: value });
        } catch {
            toast.error('Failed to update notification settings');
        }
    };

    const handleNotificationPreferences = () => {
        toast.info('Notification preferences coming soon!');
    };

    /* --------------------------- Appearance handlers --------------------------- */
    const handleThemeChange = () => {
        // Cycle theme for now – a dedicated picker can be added later
        const next = currentTheme === 'auto' ? 'light' : currentTheme === 'light' ? 'dark' : 'auto';
        handleThemeSelect(next);
    };

    const handleThemeSelect = async (selectedTheme: 'light' | 'dark' | 'auto') => {
        if (selectedTheme === currentTheme) return;
        setCurrentTheme(selectedTheme);
        try {
            await ensureToken();
            await saveSettings({ theme: selectedTheme });
        } catch {
            toast.error('Failed to update theme');
        }
    };

    const handleFontSizeChange = () => {
        toast.info('Font size selection coming soon!');
    };

    const handleLanguageChange = () => {
        toast.info('Language selection coming soon!');
    };

    const handleAccessibilitySettings = () => {
        toast.info('Accessibility settings coming soon!');
    };

    const isLoading = settingsLoading || isRefreshing;

    /* --------------------------- Render --------------------------- */
    if (isLoading) {
        return (
            <View style={[styles.container, styles.center]}>
                <ActivityIndicator size="large" color="#007AFF" />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.cancelButton} onPress={onClose || goBack}>
                    <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Settings</Text>
                <View style={{ width: 24 }} />
            </View>

            {/* Content */}
            <View style={styles.content}>
                <NotificationSection
                    pushNotifications={pushNotifications}
                    emailNotifications={emailNotifications}
                    marketingEmails={marketingEmails}
                    soundEnabled={soundEnabled}
                    onTogglePushNotifications={handleTogglePushNotifications}
                    onToggleEmailNotifications={handleToggleEmailNotifications}
                    onToggleMarketingEmails={handleToggleMarketingEmails}
                    onToggleSound={handleToggleSound}
                    onNotificationPreferences={handleNotificationPreferences}
                />

                <AppearanceSection
                    theme={currentTheme}
                    fontSize={fontSize}
                    language={language}
                    onThemeChange={handleThemeChange}
                    onFontSizeChange={handleFontSizeChange}
                    onLanguageChange={handleLanguageChange}
                    onAccessibilitySettings={handleAccessibilitySettings}
                />
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f2f2f2',
    },
    center: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        ...Platform.select({
            web: { position: 'sticky', top: 0, zIndex: 1000 } as any,
        }),
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#000',
        fontFamily: fontFamilies.phuduBold,
    },
    cancelButton: {
        padding: 5,
    },
    content: {
        flex: 1,
        padding: 16,
    },
});

export default AppSettingsScreen; 