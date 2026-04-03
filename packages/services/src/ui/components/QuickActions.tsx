import type React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@oxyhq/bloom/theme';

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
    const { isDark } = useTheme();

    return (
        <View
            className="bg-secondary"
            style={[
                styles.quickActionsContainer,
                styles.firstGroupedItem,
                styles.lastGroupedItem,
            ]}
        >
            <View style={styles.quickActionsRow}>
                {actions.map((action) => (
                    <View key={action.id} style={styles.quickActionItem}>
                        <TouchableOpacity
                            style={[
                                styles.quickActionCircle,
                                { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.03)' }
                            ]}
                            onPress={action.onPress}
                        >
                            <Ionicons name={action.icon as React.ComponentProps<typeof Ionicons>['name']} size={24} color={action.iconColor} />
                        </TouchableOpacity>
                        <Text className="text-foreground" style={styles.quickActionText}>{action.title}</Text>
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
