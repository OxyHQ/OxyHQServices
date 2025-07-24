import React from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { BaseScreenProps } from '../../navigation/types';
import { Header } from '../../components';

const KarmaAboutScreen: React.FC<BaseScreenProps> = ({ goBack, theme }) => {
    const isDarkTheme = theme === 'dark';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const primaryColor = '#d169e5';

    return (
        <View style={[styles.container, { backgroundColor }]}>
            <Header
                title="About Karma"
                subtitle="Learn about the karma system"
                theme={theme}
                onBack={goBack}
                elevation="subtle"
            />
            <ScrollView contentContainerStyle={styles.contentContainer}>
                <Text style={[styles.paragraph, { color: textColor }]}>Karma is a recognition of your positive actions in the Oxy Ecosystem. It cannot be sent or received directly, only earned by contributing to the community.</Text>
                <Text style={[styles.section, { color: primaryColor }]}>How to Earn Karma</Text>
                <Text style={[styles.paragraph, { color: textColor }]}>• Helping other users{'\n'}
                    • Reporting bugs{'\n'}
                    • Contributing content{'\n'}
                    • Participating in events{'\n'}
                    • Other positive actions</Text>
                <Text style={[styles.section, { color: primaryColor }]}>Why Karma?</Text>
                <Text style={[styles.paragraph, { color: textColor }]}>Karma unlocks special features and recognition in the Oxy Ecosystem. The more you contribute, the more you earn!</Text>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    title: {
        fontFamily: Platform.OS === 'web'
            ? 'Phudu'  // Use CSS font name directly for web
            : 'Phudu-Bold',  // Use exact font name as registered with Font.loadAsync
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
        fontSize: 54,
        margin: 24,
        marginBottom: 24,
    },
    contentContainer: { padding: 24, paddingTop: 20 },
    section: { fontSize: 18, fontWeight: 'bold', marginTop: 24, marginBottom: 8 },
    paragraph: { fontSize: 16, marginBottom: 12 },
});

export default KarmaAboutScreen;
