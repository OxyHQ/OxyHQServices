import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { FollowButton, useFollow } from '@oxyhq/services/ui';

/**
 * Example demonstrating the unified follow functionality
 * Shows how multiple follow buttons with the same user ID stay synchronized
 */
const FollowExample = () => {
    const userId1 = "user123";
    const userId2 = "user456";
    const userIds = [userId1, userId2, "user789"];

    // Single user hook
    const { isFollowing: user1Following } = useFollow(userId1);

    // Multiple users hook  
    const {
        followData,
        toggleFollowForUser,
        isAnyLoading,
        allFollowing
    } = useFollow(userIds);

    return (
        <ScrollView style={styles.container}>
            <Text style={styles.title}>Follow Button Examples</Text>

            {/* Single User - Multiple Buttons */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                    Single User ({userId1}) - Multiple Synchronized Buttons
                </Text>
                <Text style={styles.status}>
                    Status: {user1Following ? 'Following' : 'Not Following'}
                </Text>

                <View style={styles.buttonRow}>
                    <FollowButton userId={userId1} size="large" />
                    <FollowButton userId={userId1} size="medium" />
                    <FollowButton userId={userId1} size="small" />
                </View>
                <Text style={styles.note}>
                    ↑ All buttons update simultaneously when any one is clicked
                </Text>
            </View>

            {/* Multiple Users */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Multiple Users Management</Text>
                <Text style={styles.status}>
                    Any Loading: {isAnyLoading ? 'Yes' : 'No'} |
                    All Following: {allFollowing ? 'Yes' : 'No'}
                </Text>

                {userIds.map(userId => (
                    <View key={userId} style={styles.userRow}>
                        <Text style={styles.userId}>{userId}</Text>
                        <FollowButton
                            userId={userId}
                            size="medium"
                            initiallyFollowing={followData[userId]?.isFollowing}
                        />
                        <Text style={styles.userStatus}>
                            {followData[userId]?.isLoading ? 'Loading...' :
                                followData[userId]?.isFollowing ? 'Following' : 'Not Following'}
                        </Text>
                    </View>
                ))}
            </View>

            {/* Mixed Usage */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Mixed Usage Example</Text>
                <Text style={styles.note}>
                    Same user appears in both single and multiple hooks - state stays synced!
                </Text>

                <View style={styles.mixedRow}>
                    <View>
                        <Text>Single Hook Button:</Text>
                        <FollowButton userId={userId2} size="medium" />
                    </View>

                    <View>
                        <Text>Multiple Hook Button:</Text>
                        <FollowButton userId={userId2} size="medium" />
                        <Text style={styles.smallText}>
                            Status: {followData[userId2]?.isFollowing ? 'Following' : 'Not Following'}
                        </Text>
                    </View>
                </View>
            </View>

            <View style={styles.footer}>
                <Text style={styles.footerText}>
                    🎯 All buttons with the same user ID stay synchronized
                </Text>
                <Text style={styles.footerText}>
                    🔄 State changes sync automatically with backend via core services
                </Text>
                <Text style={styles.footerText}>
                    ⚡ Single useFollow hook handles both single and multiple users
                </Text>
                <Text style={styles.footerText}>
                    🔐 Shows helpful toast instead of disabling when not signed in
                </Text>
            </View>
        </ScrollView>
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
        marginBottom: 20,
        color: '#333',
    },
    section: {
        backgroundColor: 'white',
        padding: 15,
        marginBottom: 15,
        borderRadius: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
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
    mixedRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        marginTop: 10,
    },
    note: {
        fontSize: 12,
        color: '#888',
        fontStyle: 'italic',
        textAlign: 'center',
        marginTop: 5,
    },
    smallText: {
        fontSize: 10,
        color: '#666',
        marginTop: 2,
    },
    footer: {
        marginTop: 20,
        padding: 15,
        backgroundColor: '#e8f4fd',
        borderRadius: 10,
    },
    footerText: {
        fontSize: 14,
        color: '#0066cc',
        marginBottom: 5,
        textAlign: 'center',
    },
});

export default FollowExample; 