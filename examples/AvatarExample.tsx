import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Avatar } from '../src/ui';

/**
 * Example component demonstrating the Avatar component with various configurations
 */
const AvatarExample = () => {
    const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>('light');

    // Toggle between light and dark theme
    const toggleTheme = () => {
        setCurrentTheme(currentTheme === 'light' ? 'dark' : 'light');
    };

    // Sample user data
    const sampleUsers = [
        { name: 'John Doe', uri: 'https://i.pravatar.cc/300?u=john' },
        { name: 'Jane Smith', uri: 'https://i.pravatar.cc/300?u=jane' },
        { name: 'Alex Johnson', uri: undefined },
        { name: 'Taylor Swift', uri: 'https://i.pravatar.cc/300?u=taylor' },
        { name: 'Morgan Freeman', uri: undefined },
    ];

    return (
        <ScrollView style={[styles.container, {
            backgroundColor: currentTheme === 'light' ? '#FFFFFF' : '#121212'
        }]}>
            <View style={styles.content}>
                <Text style={[styles.title, {
                    color: currentTheme === 'light' ? '#333333' : '#FFFFFF'
                }]}>
                    Avatar Component Demo
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

                {/* Basic Avatar Examples */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, {
                        color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                    }]}>
                        Basic Avatars
                    </Text>
                    <View style={[styles.demoBox, {
                        backgroundColor: currentTheme === 'light' ? '#F5F5F5' : '#333333'
                    }]}>
                        <View style={styles.avatarsRow}>
                            {sampleUsers.slice(0, 3).map((user, index) => (
                                <View key={index} style={styles.avatarContainer}>
                                    <Avatar
                                        uri={user.uri}
                                        name={user.name}
                                        size={60}
                                        theme={currentTheme}
                                    />
                                    <Text style={[styles.avatarLabel, {
                                        color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                                    }]}>
                                        {user.name.split(' ')[0]}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </View>
                </View>

                {/* Different Sizes */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, {
                        color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                    }]}>
                        Different Sizes
                    </Text>
                    <View style={[styles.demoBox, {
                        backgroundColor: currentTheme === 'light' ? '#F5F5F5' : '#333333'
                    }]}>
                        <View style={styles.avatarsRow}>
                            <View style={styles.avatarContainer}>
                                <Avatar
                                    size={32}
                                    name="Small"
                                    theme={currentTheme}
                                />
                                <Text style={[styles.avatarLabel, {
                                    color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                                }]}>Small</Text>
                            </View>
                            <View style={styles.avatarContainer}>
                                <Avatar
                                    size={64}
                                    name="Medium"
                                    theme={currentTheme}
                                />
                                <Text style={[styles.avatarLabel, {
                                    color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                                }]}>Medium</Text>
                            </View>
                            <View style={styles.avatarContainer}>
                                <Avatar
                                    size={96}
                                    name="Large"
                                    theme={currentTheme}
                                />
                                <Text style={[styles.avatarLabel, {
                                    color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                                }]}>Large</Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Custom Colors */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, {
                        color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                    }]}>
                        Custom Colors
                    </Text>
                    <View style={[styles.demoBox, {
                        backgroundColor: currentTheme === 'light' ? '#F5F5F5' : '#333333'
                    }]}>
                        <View style={styles.avatarsRow}>
                            <View style={styles.avatarContainer}>
                                <Avatar
                                    size={60}
                                    text="C"
                                    backgroundColor="#0066CC"
                                    theme={currentTheme}
                                />
                                <Text style={[styles.avatarLabel, {
                                    color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                                }]}>Blue</Text>
                            </View>
                            <View style={styles.avatarContainer}>
                                <Avatar
                                    size={60}
                                    text="C"
                                    backgroundColor="#2E7D32"
                                    theme={currentTheme}
                                />
                                <Text style={[styles.avatarLabel, {
                                    color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                                }]}>Green</Text>
                            </View>
                            <View style={styles.avatarContainer}>
                                <Avatar
                                    size={60}
                                    text="C"
                                    backgroundColor="#D32F2F"
                                    theme={currentTheme}
                                />
                                <Text style={[styles.avatarLabel, {
                                    color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                                }]}>Red</Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Loading State */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, {
                        color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                    }]}>
                        Loading State
                    </Text>
                    <View style={[styles.demoBox, {
                        backgroundColor: currentTheme === 'light' ? '#F5F5F5' : '#333333'
                    }]}>
                        <View style={styles.avatarsRow}>
                            <View style={styles.avatarContainer}>
                                <Avatar
                                    size={60}
                                    isLoading={true}
                                    theme={currentTheme}
                                />
                                <Text style={[styles.avatarLabel, {
                                    color: currentTheme === 'light' ? '#666666' : '#BBBBBB'
                                }]}>Loading</Text>
                            </View>
                        </View>
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
    section: {
        marginBottom: 30,
    },
    sectionTitle: {
        fontSize: 16,
        marginBottom: 10,
    },
    demoBox: {
        padding: 20,
        borderRadius: 35,
        alignItems: 'center',
    },
    avatarsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        width: '100%',
    },
    avatarContainer: {
        alignItems: 'center',
        margin: 10,
    },
    avatarLabel: {
        marginTop: 8,
        fontSize: 14,
    },
});

export default AvatarExample;
