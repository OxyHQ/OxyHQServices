import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { OxyLogo } from '../src/ui/components/OxyLogo';

/**
 * Example component demonstrating theme-aware OxyLogo
 */
const LogoThemeExample = () => {
    const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>('light');

    // Toggle between light and dark theme
    const toggleTheme = () => {
        setCurrentTheme(currentTheme === 'light' ? 'dark' : 'light');
    };

    return (
        <ScrollView style={[styles.container, {
            backgroundColor: currentTheme === 'light' ? '#FFFFFF' : '#121212'
        }]}>
            <View style={styles.content}>
                <Text style={[styles.title, {
                    color: currentTheme === 'light' ? '#333333' : '#FFFFFF'
                }]}>
                    OxyLogo Theme Demo
                </Text>

                <TouchableOpacity
                    style={[styles.themeButton, {
                        backgroundColor: currentTheme === 'light' ? '#d169e5' : '#db85ec'
                    }]}
                    onPress={toggleTheme}
                >
                    <Text style={styles.buttonText}>
                        Switch to {currentTheme === 'light' ? 'Dark' : 'Light'} Theme
                    </Text>
                </TouchableOpacity>

                <View style={styles.logoContainer}>
                    <Text style={[styles.sectionTitle, {
                        color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                    }]}>
                        Default Logo (Theme-Aware)
                    </Text>
                    <View style={[styles.demoBox, {
                        backgroundColor: currentTheme === 'light' ? '#F5F5F5' : '#333333'
                    }]}>
                        <OxyLogo width={100} height={60} theme={currentTheme} />
                    </View>
                </View>

                <View style={styles.logoContainer}>
                    <Text style={[styles.sectionTitle, {
                        color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                    }]}>
                        Custom Colored Logo
                    </Text>
                    <View style={[styles.demoBox, {
                        backgroundColor: currentTheme === 'light' ? '#F5F5F5' : '#333333'
                    }]}>
                        <OxyLogo
                            width={100}
                            height={60}
                            theme={currentTheme}
                            fillColor="#0066CC"
                            secondaryFillColor="#5499FF"
                        />
                    </View>
                </View>

                <View style={styles.logoContainer}>
                    <Text style={[styles.sectionTitle, {
                        color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                    }]}>
                        Various Sizes
                    </Text>
                    <View style={[styles.sizesContainer, {
                        backgroundColor: currentTheme === 'light' ? '#F5F5F5' : '#333333'
                    }]}>
                        <OxyLogo width={40} height={24} theme={currentTheme} />
                        <OxyLogo width={80} height={48} theme={currentTheme} />
                        <OxyLogo width={120} height={72} theme={currentTheme} />
                    </View>
                </View>
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        padding: 20,
        paddingBottom: 40,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
        textAlign: 'center',
    },
    themeButton: {
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 35,
        alignItems: 'center',
        marginBottom: 30,
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    logoContainer: {
        marginBottom: 30,
    },
    sectionTitle: {
        fontSize: 16,
        marginBottom: 10,
    },
    demoBox: {
        padding: 20,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sizesContainer: {
        padding: 20,
        borderRadius: 8,
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
    },
});

export default LogoThemeExample;
