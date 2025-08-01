import type React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Platform,
    Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import OxyIcon from './icon/OxyIcon';
import { fontFamilies } from '../styles/fonts';

export interface HeaderProps {
    title: string;
    subtitle?: string;
    onBack?: () => void;
    onClose?: () => void;
    rightAction?: {
        icon?: string;
        onPress: () => void;
        loading?: boolean;
        disabled?: boolean;
        text?: string;
    };
    theme: 'light' | 'dark';
    showBackButton?: boolean;
    showCloseButton?: boolean;
    variant?: 'default' | 'large' | 'minimal' | 'gradient';
    elevation?: 'none' | 'subtle' | 'prominent';
    subtitleVariant?: 'default' | 'small' | 'large' | 'muted';
    titleAlignment?: 'left' | 'center' | 'right';
}

const Header: React.FC<HeaderProps> = ({
    title,
    subtitle,
    onBack,
    onClose,
    rightAction,
    theme,
    showBackButton = true,
    showCloseButton = false,
    variant = 'default',
    elevation = 'subtle',
    subtitleVariant = 'default',
    titleAlignment = 'left',
}) => {
    const isDarkTheme = theme === 'dark';

    // Modern color palette
    const colors = {
        background: isDarkTheme ? '#1C1C1E' : '#FFFFFF',
        surface: isDarkTheme ? '#2C2C2E' : '#F8F9FA',
        primary: '#007AFF',
        secondary: isDarkTheme ? '#8E8E93' : '#6C757D',
        text: {
            primary: isDarkTheme ? '#FFFFFF' : '#1A1A1A',
            secondary: isDarkTheme ? '#8E8E93' : '#6C757D',
            tertiary: isDarkTheme ? '#636366' : '#ADB5BD',
        },
        border: isDarkTheme ? '#38383A' : '#E9ECEF',
        accent: '#5856D6',
        success: '#34C759',
        warning: '#FF9500',
        error: '#FF3B30',
    };

    const renderBackButton = () => {
        if (!showBackButton || !onBack) return null;

        return (
            <TouchableOpacity
                style={[
                    styles.backButton,
                    { backgroundColor: colors.surface }
                ]}
                onPress={onBack}
                activeOpacity={0.7}
            >
                <OxyIcon name="chevron-back" size={18} color={colors.primary} />
            </TouchableOpacity>
        );
    };

    const renderCloseButton = () => {
        if (!showCloseButton || !onClose) return null;

        return (
            <TouchableOpacity
                style={[
                    styles.closeButton,
                    { backgroundColor: colors.surface }
                ]}
                onPress={onClose}
                activeOpacity={0.7}
            >
                <Ionicons name="close" size={18} color={colors.text.primary} />
            </TouchableOpacity>
        );
    };

    const renderRightAction = () => {
        if (!rightAction) return null;

        const isTextAction = rightAction.text;

        return (
            <TouchableOpacity
                style={[
                    styles.rightActionButton,
                    isTextAction ? styles.textActionButton : styles.iconActionButton,
                    {
                        backgroundColor: isTextAction ? colors.primary : colors.surface,
                        opacity: rightAction.disabled ? 0.5 : 1
                    }
                ]}
                onPress={rightAction.onPress}
                disabled={rightAction.disabled || rightAction.loading}
                activeOpacity={0.7}
            >
                {rightAction.loading ? (
                    <View style={styles.loadingContainer}>
                        <View style={[styles.loadingDot, { backgroundColor: isTextAction ? '#FFFFFF' : colors.primary }]} />
                        <View style={[styles.loadingDot, { backgroundColor: isTextAction ? '#FFFFFF' : colors.primary }]} />
                        <View style={[styles.loadingDot, { backgroundColor: isTextAction ? '#FFFFFF' : colors.primary }]} />
                    </View>
                ) : isTextAction ? (
                    <Text style={[styles.actionText, { color: '#FFFFFF' }]}>
                        {rightAction.text}
                    </Text>
                ) : (
                    <Ionicons name={rightAction.icon as any} size={18} color={colors.primary} />
                )}
            </TouchableOpacity>
        );
    };

    const renderTitle = () => {
        const titleStyle = variant === 'large' ? styles.titleLarge :
            variant === 'minimal' ? styles.titleMinimal :
                styles.titleDefault;

        const subtitleStyle = variant === 'large' ? styles.subtitleLarge :
            variant === 'minimal' ? styles.subtitleMinimal :
                subtitleVariant === 'small' ? styles.subtitleSmall :
                    subtitleVariant === 'large' ? styles.subtitleLarge :
                        subtitleVariant === 'muted' ? styles.subtitleMuted :
                            styles.subtitleDefault;

        const getTitleAlignment = () => {
            switch (titleAlignment) {
                case 'center':
                    return styles.titleContainerCenter;
                case 'right':
                    return styles.titleContainerRight;
                default:
                    return styles.titleContainerLeft;
            }
        };

        return (
            <View style={[
                styles.titleContainer,
                getTitleAlignment(),
                variant === 'minimal' && styles.titleContainerMinimal
            ]}>
                <Text style={[titleStyle, { color: colors.text.primary }]}>
                    {title}
                </Text>
                {subtitle && (
                    <Text style={[subtitleStyle, { color: colors.text.secondary }]}>
                        {subtitle}
                    </Text>
                )}
            </View>
        );
    };

    const getElevationStyle = () => {
        switch (elevation) {
            case 'none':
                return {};
            case 'subtle':
                return Platform.select({
                    web: {
                        boxShadow: isDarkTheme
                            ? '0 1px 3px rgba(0,0,0,0.3)'
                            : '0 1px 3px rgba(0,0,0,0.1)',
                    },
                    default: {
                        shadowColor: '#000000',
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: isDarkTheme ? 0.3 : 0.1,
                        shadowRadius: 3,
                        elevation: 2,
                    },
                });
            case 'prominent':
                return Platform.select({
                    web: {
                        boxShadow: isDarkTheme
                            ? '0 4px 12px rgba(0,0,0,0.4)'
                            : '0 4px 12px rgba(0,0,0,0.15)',
                    },
                    default: {
                        shadowColor: '#000000',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: isDarkTheme ? 0.4 : 0.15,
                        shadowRadius: 12,
                        elevation: 8,
                    },
                });
            default:
                return {};
        }
    };

    const getBackgroundStyle = () => {
        if (variant === 'gradient') {
            return {
                backgroundColor: isDarkTheme ? '#1C1C1E' : '#FFFFFF',
                // Add gradient overlay effect
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            };
        }

        return {
            backgroundColor: colors.background,
            borderBottomWidth: elevation === 'none' ? 0 : 1,
            borderBottomColor: colors.border,
        };
    };

    return (
        <View style={[
            styles.container,
            getBackgroundStyle(),
            getElevationStyle(),
        ]}>
            <View style={[
                styles.content,
                variant === 'minimal' && styles.contentMinimal
            ]}>
                {renderBackButton()}
                {renderTitle()}
                {renderRightAction()}
                {renderCloseButton()}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        paddingTop: Platform.OS === 'ios' ? 50 : 16,
        paddingBottom: 12,
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        ...Platform.select({
            web: {
                position: 'sticky' as any,
            },
            default: {},
        }),
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        position: 'relative',
        minHeight: 40,
    },
    contentMinimal: {
        paddingHorizontal: 12,
        minHeight: 36,
    },
    backButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 10,
    },
    titleContainer: {
        flex: 1,
        alignItems: 'flex-start',
        justifyContent: 'center',
    },
    titleContainerLeft: {
        alignItems: 'flex-start',
    },
    titleContainerCenter: {
        alignItems: 'center',
    },
    titleContainerRight: {
        alignItems: 'flex-end',
    },
    titleContainerMinimal: {
        alignItems: 'center',
        marginHorizontal: 16,
    },
    titleDefault: {
        fontSize: 18,
        fontWeight: '700',
        fontFamily: fontFamilies.phuduBold,
        letterSpacing: -0.5,
        lineHeight: 22,
    },
    titleLarge: {
        fontSize: 28,
        fontWeight: '800',
        fontFamily: fontFamilies.phuduExtraBold,
        letterSpacing: -1,
        lineHeight: 34,
        marginBottom: 3,
    },
    titleMinimal: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        letterSpacing: -0.3,
        lineHeight: 20,
    },
    subtitleDefault: {
        fontSize: 14,
        fontWeight: '400',
        lineHeight: 17,
        marginTop: 1,
    },
    subtitleLarge: {
        fontSize: 16,
        fontWeight: '400',
        lineHeight: 19,
        marginTop: 3,
    },
    subtitleMinimal: {
        fontSize: 13,
        fontWeight: '400',
        lineHeight: 15,
        marginTop: 1,
    },
    subtitleSmall: {
        fontSize: 12,
        fontWeight: '400',
        lineHeight: 14,
        marginTop: 0,
    },
    subtitleMuted: {
        fontSize: 14,
        fontWeight: '400',
        lineHeight: 17,
        marginTop: 1,
        opacity: 0.7,
    },
    rightActionButton: {
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 10,
    },
    iconActionButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
    },
    textActionButton: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 18,
        minWidth: 56,
    },
    actionText: {
        fontSize: 14,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        letterSpacing: -0.2,
    },
    loadingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
    },
    loadingDot: {
        width: 4,
        height: 4,
        borderRadius: 2,
        opacity: 0.6,
    },
});

export default Header; 