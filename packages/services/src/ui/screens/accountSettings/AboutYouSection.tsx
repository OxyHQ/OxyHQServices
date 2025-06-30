import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { fontFamilies } from '../../styles/fonts';

interface AddressObj {
    formatted?: string;
    city?: string;
    street?: string;
}

interface LinkObj {
    url: string;
}

interface AboutYouSectionProps {
    renderField: (
        type: string,
        label: string,
        value: string,
        placeholder: string,
        icon: string,
        iconColor: string,
        multiline?: boolean,
        keyboardType?: 'default' | 'email-address' | 'url',
        isFirst?: boolean,
        isLast?: boolean,
    ) => JSX.Element;
    bio: string;
    description: string;
    addresses: AddressObj[];
    links: LinkObj[];
}

const AboutYouSection: React.FC<AboutYouSectionProps> = ({ renderField, bio, description, addresses, links }) => {
    const addressString = addresses
        .map((a) => a.formatted || a.city || a.street || '')
        .filter(Boolean)
        .join(', ');
    const linksString = links.map((l) => l.url).join(', ');

    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>About You</Text>

            {renderField(
                'bio',
                'Short Bio',
                bio,
                'Write a brief introduction (max 500 characters)',
                'chatbubble-ellipses',
                '#FF9500',
                true,
                'default',
                true,
                false,
            )}

            {renderField(
                'description',
                'About Me',
                description,
                'Share your story, interests, and more (max 1000 characters)',
                'document-text',
                '#34C759',
                true,
                'default',
                false,
                false,
            )}

            {renderField(
                'address',
                'Locations',
                addressString,
                'Add a location',
                'location',
                '#FF3B30',
                false,
                'default',
                false,
                false,
            )}

            {renderField(
                'link',
                'Links',
                linksString,
                'Add a link',
                'link',
                '#32D74B',
                false,
                'url',
                false,
                true,
            )}
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
});

export default React.memo(AboutYouSection); 