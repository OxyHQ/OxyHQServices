import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { FollowButton, useFollow } from '@oxyhq/services/ui';

/**
 * Performance test component to verify no unnecessary re-renders
 */
const PerformanceTest = () => {
    const renderCount = useRef(0);
    renderCount.current += 1;

    const [userId] = useState("perf-test-123");
    const [multipleUsers] = useState(["user1", "user2", "user3"]);

    // Single user hook test
    const singleHook = useFollow(userId);

    // Multiple users hook test  
    const multipleHook = useFollow(multipleUsers);

    console.log(`PerformanceTest rendered ${renderCount.current} times`);

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Performance Test</Text>
            <Text style={styles.renderCount}>Render Count: {renderCount.current}</Text>
            <Text style={styles.note}>
                Watch console for render count - should only increase when state actually changes
            </Text>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Single User Test</Text>
                <Text style={styles.status}>
                    Following: {singleHook.isFollowing ? 'Yes' : 'No'} |
                    Loading: {singleHook.isLoading ? 'Yes' : 'No'}
                </Text>

                <View style={styles.buttonRow}>
                    <FollowButton userId={userId} size="medium" />
                    <FollowButton userId={userId} size="small" />
                    <FollowButton userId={userId} size="large" />
                </View>
                <Text style={styles.note}>All buttons should update simultaneously</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Multiple Users Test</Text>
                <Text style={styles.status}>
                    Any Loading: {multipleHook.isAnyLoading ? 'Yes' : 'No'} |
                    All Following: {multipleHook.allFollowing ? 'Yes' : 'No'}
                </Text>

                {multipleUsers.map(uid => (
                    <View key={uid} style={styles.userRow}>
                        <Text style={styles.userId}>{uid}</Text>
                        <FollowButton userId={uid} size="small" />
                        <Text style={styles.userStatus}>
                            {multipleHook.followData[uid]?.isFollowing ? 'Following' : 'Not Following'}
                        </Text>
                    </View>
                ))}
            </View>

            <View style={styles.testSection}>
                <Text style={styles.sectionTitle}>API Test Controls</Text>

                <TouchableOpacity
                    style={styles.testButton}
                    onPress={() => singleHook.fetchStatus?.()}
                >
                    <Text style={styles.testButtonText}>Fetch Status from API</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.testButton}
                    onPress={() => multipleHook.fetchAllStatuses?.()}
                >
                    <Text style={styles.testButtonText}>Fetch All Statuses</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.testButton, { backgroundColor: '#4CAF50' }]}
                    onPress={() => singleHook.setFollowStatus?.(true)}
                >
                    <Text style={styles.testButtonText}>Set Following (Local)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.testButton, { backgroundColor: '#F44336' }]}
                    onPress={() => singleHook.setFollowStatus?.(false)}
                >
                    <Text style={styles.testButtonText}>Set Not Following (Local)</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.infoSection}>
                <Text style={styles.infoTitle}>Performance Optimizations:</Text>
                <Text style={styles.infoText}>✅ Memoized selectors prevent unnecessary re-renders</Text>
                <Text style={styles.infoText}>✅ useCallback prevents function recreation</Text>
                <Text style={styles.infoText}>✅ Optimized useEffect dependencies</Text>
                <Text style={styles.infoText}>✅ Single Redux selector per component</Text>
                <Text style={styles.infoText}>✅ Proper error handling with rejectWithValue</Text>
                <Text style={styles.infoText}>✅ Core services API integration</Text>
            </View>
        </View>
    );
};

/**
 * Individual button with render tracking
 */
const TrackedFollowButton = ({ userId, label }: { userId: string; label: string }) => {
    const renderCount = useRef(0);
    renderCount.current += 1;

    console.log(`${label} FollowButton rendered ${renderCount.current} times`);

    return (
        <View style={styles.trackedButton}>
            <Text style={styles.trackedLabel}>{label}</Text>
            <Text style={styles.trackedCount}>Renders: {renderCount.current}</Text>
            <FollowButton userId={userId} size="small" />
        </View>
    );
};

/**
 * Main performance test wrapper
 */
const FollowPerformanceTest = () => {
    const [testUserId] = useState("tracked-user-456");

    return (
        <ScrollView style={styles.container}>
            <PerformanceTest />

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Individual Button Tracking</Text>
                <Text style={styles.note}>
                    Each button tracks its own renders - should be minimal
                </Text>

                <TrackedFollowButton userId={testUserId} label="Button 1" />
                <TrackedFollowButton userId={testUserId} label="Button 2" />
                <TrackedFollowButton userId={testUserId} label="Button 3" />

                <Text style={styles.note}>
                    All buttons with same userId should stay synchronized
                </Text>
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 15,
        backgroundColor: '#f5f5f5',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 10,
        color: '#333',
    },
    renderCount: {
        fontSize: 18,
        textAlign: 'center',
        color: '#FF5722',
        fontWeight: '600',
        marginBottom: 10,
    },
    note: {
        fontSize: 12,
        color: '#666',
        textAlign: 'center',
        fontStyle: 'italic',
        marginBottom: 15,
    },
    section: {
        backgroundColor: 'white',
        padding: 15,
        marginBottom: 15,
        borderRadius: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 10,
        color: '#333',
    },
    status: {
        fontSize: 14,
        color: '#666',
        marginBottom: 10,
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        marginVertical: 10,
    },
    userRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginVertical: 8,
        paddingVertical: 5,
    },
    userId: {
        fontSize: 14,
        fontWeight: '500',
        flex: 1,
        color: '#333',
    },
    userStatus: {
        fontSize: 12,
        color: '#666',
        flex: 1,
        textAlign: 'right',
    },
    testSection: {
        backgroundColor: '#E8F5E8',
        padding: 15,
        marginBottom: 15,
        borderRadius: 10,
    },
    testButton: {
        backgroundColor: '#2196F3',
        padding: 12,
        borderRadius: 8,
        alignItems: 'center',
        marginVertical: 5,
    },
    testButtonText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '500',
    },
    trackedButton: {
        backgroundColor: '#F0F0F0',
        padding: 10,
        marginVertical: 5,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    trackedLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#333',
    },
    trackedCount: {
        fontSize: 12,
        color: '#FF5722',
        fontWeight: '600',
    },
    infoSection: {
        backgroundColor: '#E3F2FD',
        padding: 15,
        borderRadius: 10,
        marginBottom: 20,
    },
    infoTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 10,
        color: '#1976D2',
    },
    infoText: {
        fontSize: 13,
        color: '#1976D2',
        marginBottom: 5,
    },
});

export default FollowPerformanceTest; 