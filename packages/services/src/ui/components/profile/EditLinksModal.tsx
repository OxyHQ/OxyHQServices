import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Platform,
    ScrollView,
    Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useColorScheme } from '../../hooks/use-color-scheme';
import { useI18n } from '../../hooks/useI18n';
import { fontFamilies } from '../../styles/fonts';
import { useProfileEditing } from '../../hooks/useProfileEditing';

interface LinkMetadata {
    url: string;
    title?: string;
    description?: string;
    image?: string;
    id: string;
}

interface EditLinksModalProps {
    visible: boolean;
    onClose: () => void;
    initialLinks?: LinkMetadata[];
    theme?: 'light' | 'dark';
    onSave?: () => void;
}

export const EditLinksModal: React.FC<EditLinksModalProps> = ({
    visible,
    onClose,
    initialLinks = [],
    theme = 'light',
    onSave,
}) => {
    const { t } = useI18n();
    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme || 'light', colorScheme);
    const colors = themeStyles.colors;
    const { saveProfile, isSaving } = useProfileEditing();

    const [links, setLinks] = useState<LinkMetadata[]>(initialLinks);
    const [newLinkUrl, setNewLinkUrl] = useState('');

    useEffect(() => {
        if (visible) {
            setLinks(initialLinks);
            setNewLinkUrl('');
        }
    }, [visible, initialLinks]);

    const handleAddLink = () => {
        if (!newLinkUrl.trim()) return;
        const link: LinkMetadata = {
            id: `link-${Date.now()}`,
            url: newLinkUrl.trim(),
            title: newLinkUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
            description: `Link to ${newLinkUrl}`,
        };
        setLinks([...links, link]);
        setNewLinkUrl('');
    };

    const handleRemoveLink = (id: string) => {
        setLinks(links.filter(link => link.id !== id));
    };

    const handleSave = async () => {
        const success = await saveProfile({
            linksMetadata: links,
            links: links.map(link => link.url),
        });
        if (success) {
            onSave?.();
            onClose();
        }
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
                    <View style={styles.modalHeader}>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>
                            {t('editProfile.items.links.title') || 'Links'}
                        </Text>
                        <TouchableOpacity
                            onPress={handleSave}
                            disabled={isSaving}
                            style={[styles.saveButton, { opacity: isSaving ? 0.5 : 1 }]}
                        >
                            <Text style={[styles.saveButtonText, { color: colors.tint }]}>
                                {isSaving ? 'Saving...' : 'Save'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.modalBody}>
                        <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: colors.text }]}>
                                {t('editProfile.items.links.add') || 'Add Link'}
                            </Text>
                            <View style={styles.addLinkRow}>
                                <TextInput
                                    style={[
                                        styles.input,
                                        {
                                            backgroundColor: colors.card,
                                            color: colors.text,
                                            borderColor: colors.border,
                                            flex: 1,
                                        },
                                    ]}
                                    value={newLinkUrl}
                                    onChangeText={setNewLinkUrl}
                                    placeholder={t('editProfile.items.links.placeholder') || 'Enter URL (e.g., https://example.com)'}
                                    placeholderTextColor={colors.secondaryText}
                                    keyboardType="url"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    selectionColor={colors.tint}
                                />
                                <TouchableOpacity
                                    style={[styles.addButton, { backgroundColor: colors.tint }]}
                                    onPress={handleAddLink}
                                    disabled={!newLinkUrl.trim()}
                                >
                                    <Ionicons name="add" size={20} color="#fff" />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {links.length > 0 && (
                            <View style={styles.linksList}>
                                <Text style={[styles.listTitle, { color: colors.text }]}>
                                    {t('editProfile.items.links.yourLinks') || 'Your Links'} ({links.length})
                                </Text>
                                {links.map((link, index) => (
                                    <View
                                        key={link.id}
                                        style={[
                                            styles.linkItem,
                                            { backgroundColor: colors.card, borderColor: colors.border },
                                            index < links.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth },
                                        ]}
                                    >
                                        {link.image && (
                                            <Image source={{ uri: link.image }} style={styles.linkImage} />
                                        )}
                                        <View style={styles.linkInfo}>
                                            <Text style={[styles.linkTitle, { color: colors.text }]} numberOfLines={1}>
                                                {link.title || link.url}
                                            </Text>
                                            {link.description && link.description !== link.title && (
                                                <Text style={[styles.linkDescription, { color: colors.secondaryText }]} numberOfLines={1}>
                                                    {link.description}
                                                </Text>
                                            )}
                                            <Text style={[styles.linkUrl, { color: colors.secondaryText }]} numberOfLines={1}>
                                                {link.url}
                                            </Text>
                                        </View>
                                        <TouchableOpacity
                                            onPress={() => handleRemoveLink(link.id)}
                                            style={styles.removeButton}
                                        >
                                            <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                                        </TouchableOpacity>
                                    </View>
                                ))}
                            </View>
                        )}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: Platform.OS === 'ios' ? 20 : 16,
        maxHeight: '80%',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#E5E5EA',
    },
    closeButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        flex: 1,
        textAlign: 'center',
    },
    saveButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    saveButtonText: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    modalBody: {
        padding: 16,
    },
    inputGroup: {
        gap: 8,
        marginBottom: 24,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    addLinkRow: {
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
    },
    input: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        minHeight: 52,
    },
    addButton: {
        width: 52,
        height: 52,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    linksList: {
        gap: 8,
    },
    listTitle: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 8,
    },
    linkItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        gap: 12,
    },
    linkImage: {
        width: 40,
        height: 40,
        borderRadius: 8,
    },
    linkInfo: {
        flex: 1,
        gap: 4,
    },
    linkTitle: {
        fontSize: 16,
        fontWeight: '600',
    },
    linkDescription: {
        fontSize: 14,
    },
    linkUrl: {
        fontSize: 12,
    },
    removeButton: {
        padding: 8,
    },
});





