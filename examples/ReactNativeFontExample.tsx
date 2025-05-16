import React from 'react';
import {
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    View,
    ScrollView
} from 'react-native';
import {
    OxyProvider,
    setupFonts,
    fontStyles,
    fontFamilies,
    OxySignInButton
} from '@oxyhq/services';

// Call setupFonts before rendering
setupFonts();

/**
 * Example component demonstrating the use of the Phudu font in a React Native app
 */
const FontDemoScreen = () => {
    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" />
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.headerTitle}>Phudu Font Demo</Text>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Standard Font Styles</Text>
                    <View style={styles.card}>
                        <Text style={styles.headerLarge}>
                            Title Large Style
                        </Text>

                        <Text style={styles.headerMedium}>
                            Title Medium Style
                        </Text>

                        <Text style={styles.headerSmall}>
                            Title Small Style
                        </Text>
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Custom Font Weights</Text>
                    <View style={styles.card}>
                        <Text style={[styles.customHeader, { fontWeight: '300' }]}>
                            Custom Weight: 300
                        </Text>

                        <Text style={[styles.customHeader, { fontWeight: '500' }]}>
                            Custom Weight: 500
                        </Text>

                        <Text style={[styles.customHeader, { fontWeight: '700' }]}>
                            Custom Weight: 700
                        </Text>

                        <Text style={[styles.customHeader, { fontWeight: '900' }]}>
                            Custom Weight: 900
                        </Text>
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>UI Components</Text>
                    <View style={styles.card}>
                        <Text style={styles.buttonTextStyle}>
                            Button Text Style
                        </Text>

                        <View style={styles.buttonDemo}>
                            <OxySignInButton variant="contained" />
                        </View>
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Regular Text Comparison</Text>
                    <View style={styles.card}>
                        <Text style={styles.regularText}>
                            This is regular system font text. The OxyProvider UI components use the Phudu Variable Font for a distinctive look across titles and important elements.
                        </Text>

                        <View style={styles.comparisonContainer}>
                            <Text style={styles.regularText}>Regular:</Text>
                            <Text style={styles.headerSmall}>Phudu:</Text>
                        </View>
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
};

/**
 * Main App Component 
 */
const App = () => {
    // Mock OxyServices for demo purposes
    const mockOxyServices = {} as any;

    return (
        <OxyProvider
            oxyServices={mockOxyServices}
            contextOnly={false}
            theme="light"
        >
            <FontDemoScreen />
        </OxyProvider>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    content: {
        padding: 16,
        paddingBottom: 40,
    },
    headerTitle: {
        ...fontStyles.titleLarge,
        marginBottom: 24,
        textAlign: 'center',
        color: '#d169e5',
    },
    section: {
        marginBottom: 20,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 8,
        color: '#666',
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 10,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
        elevation: 2,
    },
    headerLarge: {
        ...fontStyles.titleLarge,
        marginBottom: 16,
        color: '#333',
    },
    headerMedium: {
        ...fontStyles.titleMedium,
        marginBottom: 16,
        color: '#333',
    },
    headerSmall: {
        ...fontStyles.titleSmall,
        marginBottom: 16,
        color: '#333',
    },
    customHeader: {
        fontFamily: fontFamilies.phudu,
        fontSize: 18,
        marginBottom: 12,
        color: '#333',
    },
    buttonTextStyle: {
        ...fontStyles.buttonText,
        marginBottom: 16,
    },
    regularText: {
        fontSize: 16,
        lineHeight: 22,
        marginBottom: 16,
        color: '#555',
    },
    buttonDemo: {
        marginBottom: 8,
    },
    comparisonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
});

export default App;
