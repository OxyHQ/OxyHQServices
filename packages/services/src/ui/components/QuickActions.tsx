import type React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/use-color-scheme';

interface QuickAction {
    id: string;
    icon: string;
    iconColor: string;
    title: string;
    onPress: () => void;
}

interface QuickActionsProps {
    actions: QuickAction[];
    theme: 'light' | 'dark';
}

const QuickActions: React.FC<QuickActionsProps> = ({ actions, theme }) => {
    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme, colorScheme);
    const textColor = themeStyles.textColor;
    const secondaryBackgroundColor = themeStyles.secondaryBackgroundColor;

    return (
        <View style={[
            styles.quickActionsContainer,
            styles.firstGroupedItem,
            styles.lastGroupedItem,
            { backgroundColor: secondaryBackgroundColor }
        ]}>
            <View style={styles.quickActionsRow}>
                {actions.map((action) => (
                    <View key={action.id} style={styles.quickActionItem}>
                        <TouchableOpacity
                            style={[
                                styles.quickActionCircle,
                                { backgroundColor: themeStyles.isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.03)' }
                            ]}
                            onPress={action.onPress}
                        >
                            <Ionicons name={action.icon as any} size={24} color={action.iconColor} />
                        </TouchableOpacity>
                        <Text style={[styles.quickActionText, { color: textColor }]}>{action.title}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    quickActionsContainer: {
        padding: 16,
        marginBottom: 8,
    },
    firstGroupedItem: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    },
    lastGroupedItem: {
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        marginBottom: 8,
    },
    quickActionsRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-around',
        flexWrap: 'wrap',
    },
    quickActionItem: {
        alignItems: 'center',
        minWidth: 70,
        marginBottom: 8,
    },
    quickActionCircle: {
        width: 50,
        height: 50,
        borderRadius: 25,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    quickActionText: {
        fontSize: 12,
        fontWeight: '500',
        textAlign: 'center',
    },
});

export default QuickActions;
