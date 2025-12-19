/**
 * Back side of the ID card component displaying public key and identity information.
 * Features a large, readable public key like real IDs show numbers.
 */

import { Platform, StyleSheet, Text, View } from 'react-native';

interface BackSideProps {
    publicKey?: string;
    displayName?: string;
    accountCreated?: string;
}

export const BackSide: React.FC<BackSideProps> = ({
    publicKey,
    displayName,
    accountCreated
}) => {
    // Format public key for display (split into groups for readability)
    const formatPublicKey = (key?: string) => {
        if (!key) return 'N/A';
        // Remove 0x prefix if present
        const cleanKey = key.replace(/^0x/i, '');
        // Split into groups of 8 characters for better readability
        return cleanKey.match(/.{1,8}/g)?.join(' ') || cleanKey;
    };

    // Format date for display
    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();
        return `${month}/${day}/${year}`;
    };

    return (
        <View style={styles.container}>
            {/* Main public key display - large and readable */}
            <View style={styles.keySection}>
                <Text style={styles.keyLabel}>PUBLIC KEY</Text>
                <Text style={styles.keyValue} selectable>
                    {formatPublicKey(publicKey)}
                </Text>
            </View>

            {/* Additional information */}
            <View style={styles.infoSection}>
                <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>ISSUED</Text>
                    <Text style={styles.infoValue}>
                        {formatDate(accountCreated)}
                    </Text>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 24,
        justifyContent: 'space-between',
    },
    keySection: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'flex-start',
    },
    keyLabel: {
        color: '#8E8E93',
        fontFamily: Platform.select({
            ios: 'SF Pro Text',
            default: 'System',
        }),
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 12,
        fontWeight: '400',
    },
    keyValue: {
        color: '#1C1C1E',
        fontFamily: Platform.select({
            ios: 'SF Mono',
            default: 'monospace',
        }),
        fontSize: 10,
        fontWeight: '400',
        letterSpacing: 0.3,
        lineHeight: 15,
    },
    infoSection: {
        marginTop: 'auto',
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    infoLabel: {
        color: '#8E8E93',
        fontFamily: Platform.select({
            ios: 'SF Pro Text',
            default: 'System',
        }),
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        fontWeight: '400',
    },
    infoValue: {
        color: '#1C1C1E',
        fontFamily: Platform.select({
            ios: 'SF Pro Display',
            default: 'System',
        }),
        fontSize: 12,
        fontWeight: '500',
        textAlign: 'right',
    },
});
