import React from 'react';
import { AppRegistry, View, Text, StyleSheet } from 'react-native';
import {
    OxyProvider,
    setupFonts,
    OxySignInButton,
    fontStyles,
    fontFamilies
} from '@oxyhq/services';

// Call setupFonts before rendering to setup web fonts
setupFonts();

// Demo App component that showcases font usage
const FontDemo = () => (
    <View style={styles.container}>
        <Text style={styles.titleLarge}>Phudu Font - Title Large</Text>
        <Text style={styles.titleMedium}>Phudu Font - Title Medium</Text>
        <Text style={styles.titleSmall}>Phudu Font - Title Small</Text>

        <View style={styles.separator} />

        <Text style={styles.regularText}>
            This is regular text without the Phudu font. The OxyProvider UI components use
            the Phudu font in various weights for a distinctive look across the application.
        </Text>

        <View style={styles.separator} />

        <Text style={styles.customTitle}>Custom Phudu Text with 600 Weight</Text>

        <View style={styles.buttonContainer}>
            <OxySignInButton variant="contained" />
        </View>
    </View>
);

// Main entry point for the application
const RootComponent = () => (
    <OxyProvider
        oxyServices={{} as any /* Mock OxyServices instance for demo */}
        contextOnly={false}
        theme="light"
    >
        <FontDemo />
    </OxyProvider>
);

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        maxWidth: 600,
        alignSelf: 'center',
        marginTop: 40,
        backgroundColor: '#f8f8f8',
        borderRadius: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    titleLarge: {
        ...fontStyles.titleLarge,
        marginBottom: 16,
        color: '#333',
    },
    titleMedium: {
        ...fontStyles.titleMedium,
        marginBottom: 16,
        color: '#333',
    },
    titleSmall: {
        ...fontStyles.titleSmall,
        marginBottom: 16,
        color: '#333',
    },
    regularText: {
        fontSize: 16,
        lineHeight: 24,
        marginBottom: 16,
        color: '#666',
    },
    customTitle: {
        // For web: CSS will handle the font-weight with the same font family name
        // For native: Platform.select in fontFamilies will use the right static font
        fontFamily: fontFamilies.phuduSemiBold,
        fontSize: 22,
        fontWeight: '600',
        marginBottom: 16,
        color: '#d169e5',
    },
    separator: {
        height: 1,
        backgroundColor: '#e0e0e0',
        marginVertical: 20,
    },
    buttonContainer: {
        marginTop: 20,
    }
});

// Register the app
AppRegistry.registerComponent('OxyApp', () => RootComponent);

// For web, we also need to register the browser renderer
if (typeof document !== 'undefined') {
    const rootTag = document.getElementById('root');
    AppRegistry.runApplication('OxyApp', { rootTag });
}
