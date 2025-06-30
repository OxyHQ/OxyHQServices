import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { toast } from '../../../lib/sonner';
import OxyIcon from '../../components/icon/OxyIcon';
import { fontFamilies } from '../../styles/fonts';

interface AppearanceSectionProps {
    theme: 'light' | 'dark' | 'auto';
    fontSize: 'small' | 'medium' | 'large';
    language: string;
    onThemeChange: () => void;
    onFontSizeChange: () => void;
    onLanguageChange: () => void;
    onAccessibilitySettings: () => void;
}

const AppearanceSection: React.FC<AppearanceSectionProps> = ({
    theme,
    fontSize,
    language,
    onThemeChange,
    onFontSizeChange,
    onLanguageChange,
    onAccessibilitySettings,
}) => {
    const getThemeDisplayName = (theme: string) => {
        switch (theme) {
            case 'light': return 'Light';
            case 'dark': return 'Dark';
            case 'auto': return 'Auto';
            default: return 'Auto';
        }
    };

    const getFontSizeDisplayName = (size: string) => {
        switch (size) {
            case 'small': return 'Small';
            case 'medium': return 'Medium';
            case 'large': return 'Large';
            default: return 'Medium';
        }
    };

    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Appearance</Text>

            <TouchableOpacity
                style={[styles.settingItem, styles.firstSettingItem]}
                onPress={onThemeChange}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="moon" size={20} color="#5856D6" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Theme</Text>
                        <Text style={styles.settingDescription}>Choose your preferred appearance</Text>
                    </View>
                </View>
                <View style={styles.settingValue}>
                    <Text style={styles.valueText}>{getThemeDisplayName(theme)}</Text>
                    <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                </View>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.settingItem}
                onPress={onFontSizeChange}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="textformat-size" size={20} color="#007AFF" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Text Size</Text>
                        <Text style={styles.settingDescription}>Adjust the size of text</Text>
                    </View>
                </View>
                <View style={styles.settingValue}>
                    <Text style={styles.valueText}>{getFontSizeDisplayName(fontSize)}</Text>
                    <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                </View>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.settingItem}
                onPress={onLanguageChange}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="globe" size={20} color="#FF9500" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Language</Text>
                        <Text style={styles.settingDescription}>Choose your preferred language</Text>
                    </View>
                </View>
                <View style={styles.settingValue}>
                    <Text style={styles.valueText}>{language}</Text>
                    <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                </View>
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.settingItem, styles.lastSettingItem]}
                onPress={onAccessibilitySettings}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="accessibility" size={20} color="#30D158" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Accessibility</Text>
                        <Text style={styles.settingDescription}>Customize accessibility features</Text>
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    section: { marginBottom: 24 },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    settingItem: {
        backgroundColor: '#fff',
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2,
    },
    firstSettingItem: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
    lastSettingItem: { borderBottomLeftRadius: 24, borderBottomRightRadius: 24, marginBottom: 8 },
    settingInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    settingIcon: { marginRight: 12 },
    settingLabel: { fontSize: 16, fontWeight: '500', color: '#333', marginBottom: 2 },
    settingDescription: { fontSize: 14, color: '#666' },
    settingValue: { flexDirection: 'row', alignItems: 'center' },
    valueText: {
        fontSize: 14,
        color: '#007AFF',
        marginRight: 8,
        fontWeight: '500',
    },
});

export default React.memo(AppearanceSection); 