import React from 'react';
import { View, Text, TouchableOpacity, Animated, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import OxyIcon from '../../components/icon/OxyIcon';
import { fontFamilies } from '../../styles/fonts';

interface HeaderProps {
    editingField: string | null;
    isSaving: boolean;
    saveButtonScale: Animated.Value;
    onCancel: () => void;
    onSave: () => void;
    onClose: () => void;
    getFieldIcon: (field: string) => { name: string; color: string };
    getFieldLabel: (field: string) => string;
    themePrimary: string;
}

const Header: React.FC<HeaderProps> = ({
    editingField,
    isSaving,
    saveButtonScale,
    onCancel,
    onSave,
    onClose,
    getFieldIcon,
    getFieldLabel,
    themePrimary,
}) => {
    if (editingField) {
        const fieldIcon = getFieldIcon(editingField);
        return (
            <View style={styles.headerContainer}>
                <View style={styles.topRow}>
                    <TouchableOpacity style={styles.iconBtn} onPress={onCancel}>
                        <Ionicons name="close" size={24} color="#666" />
                    </TouchableOpacity>
                    <Animated.View style={{ transform: [{ scale: saveButtonScale }] }}>
                        <TouchableOpacity
                            style={[styles.saveBtn, { backgroundColor: fieldIcon.color, opacity: isSaving ? 0.7 : 1 }]}
                            onPress={onSave}
                            disabled={isSaving}
                        >
                            {isSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
                        </TouchableOpacity>
                    </Animated.View>
                </View>
                <View style={styles.bottomRow}>
                    <OxyIcon name={fieldIcon.name} size={50} color={fieldIcon.color} style={{ marginBottom: 4 }} />
                    <Text style={styles.editTitle}>{getFieldLabel(editingField)}</Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.normalHeader}>
            <TouchableOpacity style={styles.iconBtn} onPress={onClose}>
                <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
            <Text style={styles.title}>Account Settings</Text>
            <Animated.View style={{ transform: [{ scale: saveButtonScale }] }}>
                <TouchableOpacity style={styles.iconBtn} disabled={isSaving} onPress={onSave}>
                    {isSaving ? (
                        <ActivityIndicator size="small" color={themePrimary} />
                    ) : (
                        <Ionicons name="checkmark" size={24} color={themePrimary} />
                    )}
                </TouchableOpacity>
            </Animated.View>
        </View>
    );
};

const styles = StyleSheet.create({
    headerContainer: {
        paddingHorizontal: 20,
        paddingTop: 10,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    bottomRow: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        marginTop: 8,
    },
    normalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 10,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    iconBtn: { padding: 5 },
    saveBtn: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        minWidth: 60,
        alignItems: 'center',
        justifyContent: 'center',
    },
    saveText: { color: '#fff', fontSize: 16, fontWeight: '600', fontFamily: fontFamilies.phuduSemiBold },
    title: { fontSize: 24, fontWeight: 'bold', fontFamily: fontFamilies.phuduBold },
    editTitle: { fontSize: 48, fontFamily: fontFamilies.phuduExtraBold, fontWeight: '800', color: '#000' },
});

export default Header; 