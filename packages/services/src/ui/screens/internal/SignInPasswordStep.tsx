import React from 'react';
import { View, Text, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../../components/Avatar';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';

interface SignInPasswordStepProps {
    styles: any;
    fadeAnim: Animated.Value;
    slideAnim: Animated.Value;
    scaleAnim: Animated.Value;
    colors: any;
    userProfile: any;
    username: string;
    theme: string;
    logoAnim: Animated.Value;
    errorMessage: string;
    inputScaleAnim: Animated.Value;
    isInputFocused: boolean;
    password: string;
    showPassword: boolean;
    handleInputFocus: () => void;
    handleInputBlur: () => void;
    handlePasswordChange: (text: string) => void;
    handleSignIn: () => void;
    isLoading: boolean;
    prevStep: () => void;
}

const SignInPasswordStep: React.FC<SignInPasswordStepProps> = ({
    styles,
    fadeAnim,
    slideAnim,
    scaleAnim,
    colors,
    userProfile,
    username,
    theme,
    logoAnim,
    errorMessage,
    inputScaleAnim,
    isInputFocused,
    password,
    showPassword,
    handleInputFocus,
    handleInputBlur,
    handlePasswordChange,
    handleSignIn,
    isLoading,
    prevStep,
}) => (
    <Animated.View style={[
        styles.stepContainer,
        {
            opacity: fadeAnim,
            transform: [
                { translateX: slideAnim },
                { scale: scaleAnim }
            ]
        }
    ]}>
        <View style={styles.modernUserProfileContainer}>
            <Animated.View style={[
                styles.avatarContainer,
                { transform: [{ scale: logoAnim }] }
            ]}>
                <Avatar
                    uri={userProfile?.avatar}
                    name={userProfile?.displayName || userProfile?.name || username}
                    size={100}
                    theme={theme}
                    style={styles.modernUserAvatar}
                />
                <View style={[styles.statusIndicator, { backgroundColor: colors.primary }]} />
            </Animated.View>
            <Text style={[styles.modernUserDisplayName, { color: colors.text }]}>
                {userProfile?.displayName || userProfile?.name || username}
            </Text>
            <Text style={[styles.modernUsernameSubtext, { color: colors.secondaryText }]}>
                @{username}
            </Text>
            <View style={[styles.welcomeBackBadge, { backgroundColor: colors.primary + '15' }]}>
                <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                <Text style={[styles.welcomeBackText, { color: colors.primary }]}>
                    Welcome back!
                </Text>
            </View>
        </View>
        <Animated.View style={[
            styles.modernInputContainer,
            { transform: [{ scale: inputScaleAnim }] }
        ]}>
            <TextField
                label="Password"
                icon="lock-closed-outline"
                value={password}
                onChangeText={handlePasswordChange}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                testID="password-input"
                colors={colors}
                variant="filled"
                error={errorMessage || undefined}
            />
        </Animated.View>
        <GroupedPillButtons
            buttons={[
                {
                    text: 'Back',
                    onPress: prevStep,
                    icon: 'arrow-back',
                    variant: 'transparent',
                },
                {
                    text: 'Sign In',
                    onPress: handleSignIn,
                    icon: 'log-in',
                    variant: 'primary',
                    loading: isLoading,
                    testID: 'login-button',
                },
            ]}
            colors={colors}
        />
        <View style={styles.securityNotice}>
            <Ionicons name="shield-checkmark" size={14} color={colors.secondaryText} />
            <Text style={[styles.securityText, { color: colors.secondaryText }]}>
                Your data is encrypted and secure
            </Text>
        </View>
    </Animated.View>
);

export default SignInPasswordStep; 