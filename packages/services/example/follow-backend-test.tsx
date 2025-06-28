import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFollow } from '@oxyhq/services/ui';

/**
 * Example demonstrating complete backend integration with core services
 * Shows how follow state syncs with your backend API
 */
const FollowBackendTest = ({ userId = "test123" }: { userId?: string }) => {
    const {
        isFollowing,
        isLoading,
        error,
        toggleFollow,
        fetchStatus,
        setFollowStatus
    } = useFollow(userId);

    // Fetch current status from backend on mount
    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    const handleToggleFollow = async () => {
        try {
            await toggleFollow();
            console.log(`✅ Successfully ${isFollowing ? 'unfollowed' : 'followed'} user ${userId} via backend API`);
        } catch (error) {
            console.error('❌ Backend API call failed:', error);
        }
    };

    const handleRefreshFromBackend = async () => {
        console.log('🔄 Fetching current follow status from backend...');
        await fetchStatus();
        console.log(`✅ Backend says following status for ${userId}: ${isFollowing}`);
    };

    const handleSetLocal = (status: boolean) => {
        setFollowStatus(status);
        console.log(`📱 Set local state to: ${status} (not synced with backend yet)`);
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Backend Integration Test</Text>
            <Text style={styles.userId}>User ID: {userId}</Text>

            <View style={styles.statusContainer}>
                <Text style={[styles.status, { color: isFollowing ? '#4CAF50' : '#F44336' }]}>
                    Status: {isFollowing ? 'Following' : 'Not Following'}
                </Text>
                {isLoading && <Text style={styles.loading}>Loading...</Text>}
                {error && <Text style={styles.error}>Error: {error}</Text>}
            </View>

            <View style={styles.buttonContainer}>
                <TouchableOpacity
                    style={[styles.button, styles.primaryButton]}
                    onPress={handleToggleFollow}
                    disabled={isLoading}
                >
                    <Text style={styles.buttonText}>
                        {isLoading ? 'Loading...' : isFollowing ? 'Unfollow' : 'Follow'}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.button, styles.secondaryButton]}
                    onPress={handleRefreshFromBackend}
                >
                    <Text style={[styles.buttonText, { color: '#2196F3' }]}>
                        Refresh from Backend
                    </Text>
                </TouchableOpacity>
            </View>

            <View style={styles.testContainer}>
                <Text style={styles.testTitle}>Local State Tests:</Text>
                <View style={styles.testButtons}>
                    <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#4CAF50' }]}
                        onPress={() => handleSetLocal(true)}
                    >
                        <Text style={styles.testButtonText}>Set Following</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#F44336' }]}
                        onPress={() => handleSetLocal(false)}
                    >
                        <Text style={styles.testButtonText}>Set Not Following</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.infoContainer}>
                <Text style={styles.infoTitle}>Backend API Calls:</Text>
                <Text style={styles.infoText}>• Follow: POST /users/{userId}/follow</Text>
                <Text style={styles.infoText}>• Unfollow: DELETE /users/{userId}/follow</Text>
                <Text style={styles.infoText}>• Status: GET /users/{userId}/following-status</Text>
                <Text style={styles.note}>
                    All calls use oxyServices core with proper authentication
                </Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        backgroundColor: '#f5f5f5',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 10,
        color: '#333',
    },
    userId: {
        fontSize: 16,
        textAlign: 'center',
        color: '#666',
        marginBottom: 20,
    },
    statusContainer: {
        backgroundColor: 'white',
        padding: 15,
        borderRadius: 10,
        marginBottom: 20,
        alignItems: 'center',
    },
    status: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 5,
    },
    loading: {
        fontSize: 14,
        color: '#FF9800',
        fontStyle: 'italic',
    },
    error: {
        fontSize: 14,
        color: '#F44336',
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    button: {
        flex: 1,
        padding: 15,
        borderRadius: 8,
        alignItems: 'center',
        marginHorizontal: 5,
    },
    primaryButton: {
        backgroundColor: '#2196F3',
    },
    secondaryButton: {
        backgroundColor: 'white',
        borderWidth: 1,
        borderColor: '#2196F3',
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
        color: 'white',
    },
    testContainer: {
        backgroundColor: 'white',
        padding: 15,
        borderRadius: 10,
        marginBottom: 20,
    },
    testTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 10,
        color: '#333',
    },
    testButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    testButton: {
        flex: 1,
        padding: 10,
        borderRadius: 6,
        alignItems: 'center',
        marginHorizontal: 5,
    },
    testButtonText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '500',
    },
    infoContainer: {
        backgroundColor: '#E3F2FD',
        padding: 15,
        borderRadius: 10,
    },
    infoTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 10,
        color: '#1976D2',
    },
    infoText: {
        fontSize: 14,
        color: '#1976D2',
        marginBottom: 5,
        fontFamily: 'monospace',
    },
    note: {
        fontSize: 12,
        color: '#666',
        marginTop: 10,
        fontStyle: 'italic',
    },
});

export default FollowBackendTest; 