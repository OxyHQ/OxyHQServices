/**
 * Front side of the ID card component displaying user identity.
 * Government ID style layout with avatar mask and formal typography.
 */

import { Platform, StyleSheet, Text, View, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface FrontSideProps {
    displayName?: string;
    username?: string;
    avatarUrl?: string;
    accountCreated?: string;
    publicKeyShort?: string;
}

export const FrontSide: React.FC<FrontSideProps> = ({
    displayName,
    username,
    avatarUrl,
    accountCreated,
    publicKeyShort
}) => {
    return (
        <View style={styles.container}>
            {/* Main content area */}
            <View style={styles.content}>
                {/* Avatar section with government ID style fade mask */}
                <View style={styles.avatarSection}>
                    <View style={styles.avatarContainer}>
                        {avatarUrl ? (
                            <Image
                                source={{ uri: avatarUrl }}
                                style={styles.avatar}
                                resizeMode="cover"
                            />
                        ) : (
                            <View style={styles.avatarPlaceholder}>
                                <Text style={styles.avatarPlaceholderText}>
                                    {displayName?.charAt(0)?.toUpperCase() || '?'}
                                </Text>
                            </View>
                        )}
                        {/* Oval fade mask - government ID style (only fades edges, center stays fully visible) */}
                        {/* Top fade - creates oval top edge */}
                        <LinearGradient
                            colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0)']}
                            locations={[0, 0.4, 1]}
                            start={{ x: 0.5, y: 0 }}
                            end={{ x: 0.5, y: 1 }}
                            style={styles.fadeOvalTop}
                        />
                        {/* Bottom fade - creates oval bottom edge */}
                        <LinearGradient
                            colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0)']}
                            locations={[0, 0.4, 1]}
                            start={{ x: 0.5, y: 1 }}
                            end={{ x: 0.5, y: 0 }}
                            style={styles.fadeOvalBottom}
                        />
                        {/* Left fade - creates oval left edge */}
                        <LinearGradient
                            colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0)']}
                            locations={[0, 0.4, 1]}
                            start={{ x: 0, y: 0.5 }}
                            end={{ x: 1, y: 0.5 }}
                            style={styles.fadeOvalLeft}
                        />
                        {/* Right fade - creates oval right edge */}
                        <LinearGradient
                            colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0)']}
                            locations={[0, 0.4, 1]}
                            start={{ x: 1, y: 0.5 }}
                            end={{ x: 0, y: 0.5 }}
                            style={styles.fadeOvalRight}
                        />
                        {/* Corner overlays for smoother oval shape - smaller to not affect center */}
                        <LinearGradient
                            colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0)']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.fadeOvalCornerTL}
                        />
                        <LinearGradient
                            colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0)']}
                            start={{ x: 1, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.fadeOvalCornerTR}
                        />
                        <LinearGradient
                            colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0)']}
                            start={{ x: 0, y: 1 }}
                            end={{ x: 1, y: 0 }}
                            style={styles.fadeOvalCornerBL}
                        />
                        <LinearGradient
                            colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0)']}
                            start={{ x: 1, y: 1 }}
                            end={{ x: 0, y: 0 }}
                            style={styles.fadeOvalCornerBR}
                        />
                    </View>
                </View>

                {/* User info section */}
                <View style={styles.infoSection}>
                    <View style={styles.field}>
                        <Text style={styles.fieldLabel}>FULL NAME</Text>
                        <Text style={styles.fieldValue} numberOfLines={2}>
                            {displayName || 'Unknown User'}
                        </Text>
                    </View>

                    {username && (
                        <View style={styles.field}>
                            <Text style={styles.fieldLabel}>USERNAME</Text>
                            <Text style={styles.fieldValueSmall} numberOfLines={1}>
                                {username}
                            </Text>
                        </View>
                    )}

                    <View style={styles.field}>
                        <Text style={styles.fieldLabel}>ID NUMBER</Text>
                        <Text style={styles.idNumber} numberOfLines={1}>
                            {publicKeyShort || 'N/A'}
                        </Text>
                    </View>
                </View>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
                <Text style={styles.footerText}>SELF-CUSTODY IDENTITY</Text>
            </View>
        </View>
    );
};

/**
 * Styles for the FrontSide component - Government ID style layout
 */
const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        justifyContent: 'space-between',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
    },
    avatarSection: {
        marginRight: 16,
        justifyContent: 'flex-start',
        alignItems: 'center',
        position: 'relative',
        alignSelf: 'stretch', // Allow section to stretch to full height
    },
    avatarContainer: {
        width: 100, // Wider than tall (government ID style)
        flex: 1, // Use full available height
        minHeight: 120, // Minimum height for portrait aspect ratio
        borderRadius: 8, // Rounded rectangle
        overflow: 'hidden',
        backgroundColor: '#FFFFFF', // White background to match card
        position: 'relative',
    },
    avatar: {
        width: '100%',
        height: '100%',
        backgroundColor: 'transparent', // Ensure no black background
    },
    fadeOvalTop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '35%', // Reduced from 45% to keep center clear
        pointerEvents: 'none',
    },
    fadeOvalBottom: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '35%', // Reduced from 45% to keep center clear
        pointerEvents: 'none',
    },
    fadeOvalLeft: {
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        width: '30%', // Reduced from 40% to keep center clear
        pointerEvents: 'none',
    },
    fadeOvalRight: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '30%', // Reduced from 40% to keep center clear
        pointerEvents: 'none',
    },
    fadeOvalCornerTL: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '28%', // Reduced from 35% to keep center clear
        height: '28%', // Reduced from 35% to keep center clear
        pointerEvents: 'none',
    },
    fadeOvalCornerTR: {
        position: 'absolute',
        top: 0,
        right: 0,
        width: '28%', // Reduced from 35% to keep center clear
        height: '28%', // Reduced from 35% to keep center clear
        pointerEvents: 'none',
    },
    fadeOvalCornerBL: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        width: '28%', // Reduced from 35% to keep center clear
        height: '28%', // Reduced from 35% to keep center clear
        pointerEvents: 'none',
    },
    fadeOvalCornerBR: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: '28%', // Reduced from 35% to keep center clear
        height: '28%', // Reduced from 35% to keep center clear
        pointerEvents: 'none',
    },
    avatarPlaceholder: {
        width: '100%',
        height: '100%',
        backgroundColor: '#E0E0E0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarPlaceholderText: {
        fontSize: 42,
        fontWeight: '600',
        color: '#8E8E93',
        fontFamily: Platform.select({
            ios: 'SF Pro Display',
            default: 'System',
        }),
    },
    infoSection: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    field: {
        marginBottom: 10,
    },
    fieldRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 4,
    },
    fieldHalf: {
        flex: 1,
        marginRight: 12,
    },
    fieldLabel: {
        color: '#6E6E73',
        fontFamily: Platform.select({
            ios: 'SF Pro Text',
            default: 'System',
        }),
        fontSize: 9,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        marginBottom: 2,
        fontWeight: '500',
    },
    fieldValue: {
        color: '#1C1C1E',
        fontFamily: Platform.select({
            ios: 'SF Pro Display',
            default: 'System',
        }),
        fontSize: 18,
        fontWeight: '600',
        letterSpacing: -0.2,
        lineHeight: 22,
    },
    fieldValueSmall: {
        color: '#1C1C1E',
        fontFamily: Platform.select({
            ios: 'SF Pro Display',
            default: 'System',
        }),
        fontSize: 14,
        fontWeight: '500',
        letterSpacing: -0.1,
    },
    idNumber: {
        color: '#1C1C1E',
        fontFamily: Platform.select({
            ios: 'SF Mono',
            default: 'monospace',
        }),
        fontSize: 12,
        fontWeight: '600',
        letterSpacing: 0.8,
    },
    footer: {
        marginTop: 12,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#E5E5EA',
        alignItems: 'center',
    },
    footerText: {
        color: '#8E8E93',
        fontFamily: Platform.select({
            ios: 'SF Pro Text',
            default: 'System',
        }),
        fontSize: 8,
        fontWeight: '400',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
});