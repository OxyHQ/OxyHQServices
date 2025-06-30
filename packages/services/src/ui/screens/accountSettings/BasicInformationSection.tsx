import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { fontFamilies } from '../../styles/fonts';

interface BasicInformationSectionProps {
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
    displayName: string;
    username: string;
    email: string;
}

const BasicInformationSection: React.FC<BasicInformationSectionProps> = ({
    renderField,
    displayName,
    username,
    email,
}) => {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Basic Information</Text>

            {renderField(
                'displayName',
                'Display Name',
                displayName,
                'Add your display name',
                'person',
                '#007AFF',
                false,
                'default',
                true,
                false,
            )}

            {renderField(
                'username',
                'Username',
                username,
                'Choose a username',
                'at',
                '#5856D6',
                false,
                'default',
                false,
                false,
            )}

            {renderField(
                'email',
                'Email',
                email,
                'Add your email address',
                'mail',
                '#FF9500',
                false,
                'email-address',
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

export default React.memo(BasicInformationSection); 