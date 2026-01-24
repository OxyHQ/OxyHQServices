import type React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Platform,
    Animated,
    Keyboard,
} from 'react-native';
import { useMemo } from 'react';
import AnimatedReanimated, { useAnimatedStyle, interpolate, Extrapolation, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import OxyIcon from './icon/OxyIcon';
import { fontFamilies } from '../styles/fonts';
import { useColorScheme } from '../hooks/use-color-scheme';
import { normalizeColorScheme } from '../utils/themeUtils';
import { Colors } from '../constants/theme';

// Calculate header height based on platform and variant
export const getHeaderHeight = (variant: HeaderProps['variant'] = 'default', safeAreaTop: number = 0): number => {
    const paddingTop = Platform.OS === 'ios' ? Math.max(safeAreaTop, 50) : 16;
    const paddingBottom = 12;
    const contentHeight = variant === 'minimal' ? 36 : 40;
    return paddingTop + contentHeight + paddingBottom;
};

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
        key?: string;
    };
    rightActions?: Array<{
        icon?: string;
        onPress: () => void;
        loading?: boolean;
        disabled?: boolean;
        text?: string;
        key?: string; // optional identifier
    }>;
    theme?: 'light' | 'dark';
    showBackButton?: boolean;
    showCloseButton?: boolean;
    showThemeToggle?: boolean;
    onThemeToggle?: () => void;
    variant?: 'default' | 'large' | 'minimal' | 'gradient';
    elevation?: 'none' | 'subtle' | 'prominent';
    subtitleVariant?: 'default' | 'small' | 'large' | 'muted';
    titleAlignment?: 'left' | 'center' | 'right';
    scrollY?: SharedValue<number>; // For sticky behavior on native
}

const Header: React.FC<HeaderProps> = ({
    title,
    subtitle,
    onBack,
    onClose,
    rightAction,
    rightActions,
    theme,
    showBackButton = true,
    showCloseButton = false,
    showThemeToggle = false,
    onThemeToggle,
    variant = 'default',
    elevation = 'subtle',
    subtitleVariant = 'default',
    titleAlignment = 'left',
    scrollY,
}) => {
    // Use theme colors directly from Colors constant (like Accounts sidebar)
    // Ensure colorScheme is always 'light' or 'dark' with proper fallback chain
    const colorScheme = normalizeColorScheme(useColorScheme(), theme);
    const colors = Colors[colorScheme];
    const insets = useSafeAreaInsets();
    const headerHeight = getHeaderHeight(variant, insets.top);

    // Animated style for sticky behavior on native
    // Only create animated style if scrollY is provided and we're on native platform
    const animatedHeaderStyle = useAnimatedStyle(() => {
        if (Platform.OS === 'web' || !scrollY) {
            return {};
        }

        // Sticky behavior: header scrolls with content initially, then sticks at top
        // When scrollY = 0, translateY = 0 (header at normal position)
        // When scrollY > 0, translateY becomes negative to keep header at top
        // Clamp to prevent header from going above viewport
        const translateY = interpolate(
            scrollY.value,
            [0, headerHeight],
            [0, -headerHeight],
            Extrapolation.CLAMP
        );

        return {
            transform: [{ translateY }],
        };
    }, [scrollY, headerHeight]);

    const handleBackPress = () => {
        if (!onBack) return;
        
        // Navigate immediately and synchronously - this prioritizes navigation
        // over keyboard dismiss. The keyboard will close naturally after screen changes.
        onBack();
    };

    const renderBackButton = () => {
        if (!showBackButton || !onBack) return null;

        return (
            <TouchableOpacity
                style={[
                    styles.backButton,
                    { backgroundColor: colors.card }
                ]}
                onPress={handleBackPress}
                activeOpacity={0.7}
            >
                <OxyIcon name="chevron-back" size={18} color={colors.tint} />
            </TouchableOpacity>
        );
    };

    const renderCloseButton = () => {
        if (!showCloseButton || !onClose) return null;

        return (
            <TouchableOpacity
                style={[
                    styles.closeButton,
                    { backgroundColor: colors.card }
                ]}
                onPress={onClose}
                activeOpacity={0.7}
            >
                <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
        );
    };

    const renderRightActionButton = (action: NonNullable<HeaderProps['rightAction']>, idx: number) => {
        const isTextAction = action.text;
        return (
            <TouchableOpacity
                key={action.key || idx}
                style={[
                    styles.rightActionButton,
                    isTextAction ? styles.textActionButton : styles.iconActionButton,
                    {
                        backgroundColor: isTextAction ? colors.tint : colors.card,
                        opacity: action.disabled ? 0.5 : 1
                    }
                ]}
                onPress={action.onPress}
                disabled={action.disabled || action.loading}
                activeOpacity={0.7}
            >
                {action.loading ? (
                    <View style={styles.loadingContainer}>
                        <View style={[styles.loadingDot, { backgroundColor: isTextAction ? '#FFFFFF' : colors.tint }]} />
                        <View style={[styles.loadingDot, { backgroundColor: isTextAction ? '#FFFFFF' : colors.tint }]} />
                        <View style={[styles.loadingDot, { backgroundColor: isTextAction ? '#FFFFFF' : colors.tint }]} />
                    </View>
                ) : isTextAction ? (
                    <Text style={[styles.actionText, { color: '#FFFFFF' }]}>
                        {action.text}
                    </Text>
                ) : (
                    <Ionicons name={action.icon as any} size={18} color={colors.tint} />
                )}
            </TouchableOpacity>
        );
    };

    const renderRightActions = () => {
        const actions: Array<NonNullable<HeaderProps['rightAction']>> = [];

        // Add existing right actions
        if (rightActions?.length) {
            actions.push(...rightActions);
        } else if (rightAction) {
            actions.push(rightAction);
        }

        // Add theme toggle button if enabled
        if (showThemeToggle && onThemeToggle) {
            actions.push({
                icon: colorScheme === 'dark' ? 'sunny' : 'moon',
                onPress: onThemeToggle,
                key: 'theme-toggle',
            });
        }

        if (actions.length === 0) return null;

        if (actions.length > 1) {
            return (
                <View style={styles.rightActionsRow}>
                    {actions.map((a, i) => renderRightActionButton(a, i))}
                </View>
            );
        }
        return renderRightActionButton(actions[0], 0);
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
                <Text style={[titleStyle, { color: colors.text }]}>
                    {title}
                </Text>
                {subtitle && (
                    <Text style={[subtitleStyle, { color: colors.secondaryText }]}>
                        {subtitle}
                    </Text>
                )}
            </View>
        );
    };

    const getElevationStyle = () => {
        const isDark = colorScheme === 'dark';
        switch (elevation) {
            case 'none':
                return {};
            case 'subtle':
                return Platform.select({
                    web: {
                        boxShadow: isDark
                            ? '0 1px 3px rgba(0,0,0,0.3)'
                            : '0 1px 3px rgba(0,0,0,0.1)',
                    },
                    default: {
                        shadowColor: '#000000',
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: isDark ? 0.3 : 0.1,
                        shadowRadius: 3,
                        elevation: 2,
                    },
                });
            case 'prominent':
                return Platform.select({
                    web: {
                        boxShadow: isDark
                            ? '0 4px 12px rgba(0,0,0,0.4)'
                            : '0 4px 12px rgba(0,0,0,0.15)',
                    },
                    default: {
                        shadowColor: '#000000',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: isDark ? 0.4 : 0.15,
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
                backgroundColor: colors.background,
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

    const backgroundStyle = getBackgroundStyle();
    const elevationStyle = getElevationStyle();

    const containerStyle = useMemo(() => [
        styles.container,
        {
            paddingTop: Platform.OS === 'ios' ? Math.max(insets.top, 50) : 16,
        },
        // When header is inside ScrollView (has scrollY), don't use absolute positioning
        !scrollY && Platform.OS !== 'web' ? {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
        } : {},
        backgroundStyle,
        elevationStyle,
    ], [insets.top, backgroundStyle, elevationStyle, scrollY]);

    const HeaderContainer = Platform.OS === 'web' || !scrollY ? View : AnimatedReanimated.View;
    // Only apply animated styles when HeaderContainer is an animated component
    const shouldUseAnimatedStyle = Platform.OS !== 'web' && scrollY !== undefined;
    const headerStyle = shouldUseAnimatedStyle 
        ? [containerStyle, animatedHeaderStyle] 
        : containerStyle;

    return (
        <HeaderContainer style={headerStyle}>
            <View style={[
                styles.content,
                variant === 'minimal' && styles.contentMinimal
            ]}>
                {renderBackButton()}
                {renderTitle()}
                {renderRightActions()}
                {renderCloseButton()}
            </View>
        </HeaderContainer>
    );
};

const styles = StyleSheet.create({
    container: {
        paddingBottom: 12,
        zIndex: 1000,
        ...Platform.select({
            web: {
                position: 'sticky' as any,
                top: 0,
                left: 0,
                right: 0,
            },
            default: {
                // Position will be set dynamically based on scrollY prop
            },
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
        fontFamily: fontFamilies.interBold,
        letterSpacing: -0.5,
        lineHeight: 22,
    },
    titleLarge: {
        fontSize: 28,
        fontWeight: '800',
        fontFamily: fontFamilies.interExtraBold,
        letterSpacing: -1,
        lineHeight: 34,
        marginBottom: 3,
    },
    titleMinimal: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.interSemiBold,
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
        fontFamily: fontFamilies.interSemiBold,
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
    rightActionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
});

export default Header; 