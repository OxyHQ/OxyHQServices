import React, { useState, useEffect } from 'react';
import {
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    View
} from 'react-native';
import {
    OxyProvider,
    setupFonts,
    fontStyles,
    fontFamilies
} from '@oxyhq/services';

// Call setupFonts before rendering
setupFonts();

const App = () => {
    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" />
            <OxyProvider
                /* your OxyProvider config */
                contextOnly={true}
            >
                <View style={styles.content}>
                    <Text style={styles.headerLarge}>
                        This is using Phudu font (titleLarge)
                    </Text>

                    <Text style={styles.headerMedium}>
                        This is using Phudu font (titleMedium)
                    </Text>

                    <Text style={styles.headerSmall}>
                        This is using Phudu font (titleSmall)
                    </Text>

                    <Text style={styles.customHeader}>
                        This is a custom Phudu style
                    </Text>

                    <Text style={styles.regularText}>
                        This is regular text without the Phudu font
                    </Text>
                </View>
            </OxyProvider>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    content: {
        flex: 1,
        padding: 20,
    },
    headerLarge: {
        ...fontStyles.titleLarge,
        marginBottom: 20,
    },
    headerMedium: {
        ...fontStyles.titleMedium,
        marginBottom: 20,
    },
    headerSmall: {
        ...fontStyles.titleSmall,
        marginBottom: 20,
    },
    customHeader: {
        fontFamily: fontFamilies.phudu,
        fontSize: 18,
        fontWeight: '500',
        marginBottom: 20,
    },
    regularText: {
        fontSize: 16,
        marginBottom: 20,
    },
});

export default App;
