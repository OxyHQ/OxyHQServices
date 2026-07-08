import type React from 'react';
import { useMemo } from 'react';
import {
    View,
    TouchableOpacity,
    StyleSheet,
    Platform,
    ActivityIndicator,
} from 'react-native';
import AnimatedReanimated, { useAnimatedStyle, interpolate, Extrapolation, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@oxyhq/bloom/theme';
import { PressableScale } from '@oxyhq/bloom/pressable-scale';
import { H4, Text } from '@oxyhq/bloom/typography';

type ThemeColors = ReturnType<typeof useTheme>['colors'];

export interface HeaderAction {
    /** Ionicons name — rendered as a circular icon button when no `text` is set. */
    icon?: string;
    /** Label — rendered as a filled pill button (takes precedence over `icon`). */
    text?: string;
    onPress: () => void;
    loading?: boolean;
    disabled?: boolean;
    /** Stable identity for lists; falls back to the array index. */
    key?: string;
}

export interface HeaderProps {
    title: string;
    subtitle?: string;
    onBack?: () => void;
    onClose?: () => void;
    /** Trailing action buttons, rendered left-to-right before the close button. */
    actions?: HeaderAction[];
    showBackButton?: boolean;
    showCloseButton?: boolean;
    variant?: 'default' | 'minimal';
    elevation?: 'none' | 'subtle' | 'prominent';
    subtitleVariant?: 'default' | 'small' | 'large' | 'muted';
    titleAlignment?: 'left' | 'center' | 'right';
    /** Shared scroll offset — enables sticky translate-up behavior on native. */
    scrollY?: SharedValue<number>;
}

export const getHeaderHeight = (variant: HeaderProps['variant'] = 'default', safeAreaTop = 0): number => {
    const paddingTop = Platform.OS === 'ios' ? Math.max(safeAreaTop, 50) : 16;
    const paddingBottom = 12;
    const contentHeight = variant === 'minimal' ? 36 : 40;
    return paddingTop + contentHeight + paddingBottom;
};

const HeaderActionButton: React.FC<{ action: HeaderAction; colors: ThemeColors }> = ({ action, colors }) => {
    const isText = !!action.text;
    return (
        <PressableScale
            onPress={action.onPress}
            disabled={action.disabled || action.loading}
            style={[
                styles.actionButton,
                isText ? styles.textActionButton : styles.iconActionButton,
                { backgroundColor: isText ? colors.tint : colors.card, opacity: action.disabled ? 0.5 : 1 },
            ]}
        >
            {action.loading ? (
                <ActivityIndicator size="small" color={isText ? colors.card : colors.tint} />
            ) : isText ? (
                <Text style={[styles.actionText, { color: colors.card }]}>{action.text}</Text>
            ) : (
                <Ionicons name={action.icon as React.ComponentProps<typeof Ionicons>['name']} size={18} color={colors.tint} />
            )}
        </PressableScale>
    );
};

const Header: React.FC<HeaderProps> = ({
    title,
    subtitle,
    onBack,
    onClose,
    actions,
    showBackButton = true,
    showCloseButton = false,
    variant = 'default',
    elevation = 'subtle',
    subtitleVariant = 'default',
    titleAlignment = 'left',
    scrollY,
}) => {
    const { colors, mode } = useTheme();
    const insets = useSafeAreaInsets();
    const headerHeight = getHeaderHeight(variant, insets.top);
    const isDark = mode === 'dark';

    // Sticky behavior on native: header translates up as content scrolls, clamped
    // so it never leaves the viewport. No-op on web (uses CSS `position: sticky`).
    const animatedHeaderStyle = useAnimatedStyle(() => {
        if (Platform.OS === 'web' || !scrollY) return {};
        const translateY = interpolate(scrollY.value, [0, headerHeight], [0, -headerHeight], Extrapolation.CLAMP);
        return { transform: [{ translateY }] };
    }, [scrollY, headerHeight]);

    const elevationStyle = useMemo(() => {
        switch (elevation) {
            case 'subtle':
                return Platform.select({
                    web: { boxShadow: isDark ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.1)' },
                    default: { shadowColor: '#000000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: isDark ? 0.3 : 0.1, shadowRadius: 3, elevation: 2 },
                });
            case 'prominent':
                return Platform.select({
                    web: { boxShadow: isDark ? '0 4px 12px rgba(0,0,0,0.4)' : '0 4px 12px rgba(0,0,0,0.15)' },
                    default: { shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: isDark ? 0.4 : 0.15, shadowRadius: 12, elevation: 8 },
                });
            default:
                return {};
        }
    }, [elevation, isDark]);

    const containerStyle = useMemo(() => [
        styles.container,
        { paddingTop: Platform.OS === 'ios' ? Math.max(insets.top, 50) : 16 },
        // Header inside a ScrollView (scrollY provided) must not be absolutely positioned.
        !scrollY && Platform.OS !== 'web' ? styles.absolute : null,
        { borderBottomWidth: elevation === 'none' ? 0 : 1 },
        elevationStyle,
    ], [insets.top, elevation, elevationStyle, scrollY]);

    const titleAlign = titleAlignment === 'center' ? styles.alignCenter
        : titleAlignment === 'right' ? styles.alignRight
            : styles.alignLeft;

    const HeaderContainer = Platform.OS === 'web' || !scrollY ? View : AnimatedReanimated.View;
    const headerStyle = Platform.OS !== 'web' && scrollY !== undefined ? [containerStyle, animatedHeaderStyle] : containerStyle;

    return (
        <HeaderContainer className="bg-bg border-border" style={headerStyle}>
            <View style={[styles.content, variant === 'minimal' && styles.contentMinimal]}>
                {showBackButton && onBack ? (
                    <TouchableOpacity className="bg-card" style={styles.circleButton} onPress={onBack} activeOpacity={0.7}>
                        <Ionicons name="chevron-back" size={18} color={colors.tint} />
                    </TouchableOpacity>
                ) : null}

                <View style={[styles.titleContainer, titleAlign, variant === 'minimal' && styles.titleContainerMinimal]}>
                    <H4 className="text-text" style={variant === 'minimal' ? styles.titleMinimal : styles.titleDefault} numberOfLines={1}>
                        {title}
                    </H4>
                    {subtitle ? (
                        <Text className="text-text-secondary" style={subtitleStyles[subtitleVariant]} numberOfLines={1}>
                            {subtitle}
                        </Text>
                    ) : null}
                </View>

                {actions?.length ? (
                    <View style={styles.actionsRow}>
                        {actions.map((action, idx) => (
                            <HeaderActionButton key={action.key ?? idx} action={action} colors={colors} />
                        ))}
                    </View>
                ) : null}

                {showCloseButton && onClose ? (
                    <TouchableOpacity className="bg-card" style={[styles.circleButton, styles.closeButton]} onPress={onClose} activeOpacity={0.7}>
                        <Ionicons name="close" size={18} color={colors.text} />
                    </TouchableOpacity>
                ) : null}
            </View>
        </HeaderContainer>
    );
};

const styles = StyleSheet.create({
    container: {
        paddingBottom: 12,
        zIndex: 1000,
        ...Platform.select({
            web: { position: 'sticky' as 'relative', top: 0, left: 0, right: 0 },
            default: {},
        }),
    },
    absolute: { position: 'absolute', top: 0, left: 0, right: 0 },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        position: 'relative',
        minHeight: 40,
    },
    contentMinimal: { paddingHorizontal: 12, minHeight: 36 },
    circleButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    closeButton: { marginRight: 0, marginLeft: 10 },
    titleContainer: { flex: 1, justifyContent: 'center' },
    alignLeft: { alignItems: 'flex-start' },
    alignCenter: { alignItems: 'center' },
    alignRight: { alignItems: 'flex-end' },
    titleContainerMinimal: { alignItems: 'center', marginHorizontal: 16 },
    titleDefault: { fontSize: 18, fontWeight: '700', letterSpacing: -0.5, lineHeight: 22 },
    titleMinimal: { fontSize: 16, fontWeight: '600', letterSpacing: -0.3, lineHeight: 20 },
    actionsRow: { flexDirection: 'row', alignItems: 'center' },
    actionButton: { alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
    iconActionButton: { width: 32, height: 32, borderRadius: 16 },
    textActionButton: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 18, minWidth: 56 },
    actionText: { fontSize: 14, fontWeight: '600', letterSpacing: -0.2 },
});

const subtitleStyles = StyleSheet.create({
    default: { fontSize: 14, fontWeight: '400', lineHeight: 17, marginTop: 1 },
    small: { fontSize: 12, fontWeight: '400', lineHeight: 14 },
    large: { fontSize: 16, fontWeight: '400', lineHeight: 19, marginTop: 3 },
    muted: { fontSize: 14, fontWeight: '400', lineHeight: 17, marginTop: 1, opacity: 0.7 },
});

export default Header;
