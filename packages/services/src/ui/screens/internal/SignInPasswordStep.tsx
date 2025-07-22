import React, { useRef, useCallback, useEffect } from 'react';
import { View, Text, Animated, TouchableOpacity, TextInput, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../../components/Avatar';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';
import { useNavigation } from '@react-navigation/native';

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
    isInputFocused,
    password,
    showPassword,
    handleInputFocus,
    handleInputBlur,
    handlePasswordChange,
    handleSignIn: parentHandleSignIn,
    isLoading,
    prevStep,
}) => {
    const navigation = useNavigation();
    const inputRef = useRef<TextInput>(null);

    const navigate = useCallback((screen: string) => {
        navigation.navigate(screen as never);
    }, [navigation]);

    // Focus password input on error or when step becomes active
    useEffect(() => {
        if (errorMessage) {
            setTimeout(() => {
                inputRef.current?.focus();
            }, 0);
        }
    }, [errorMessage]);

    const handleSignIn = useCallback(() => {
        if (!password || errorMessage) {
            setTimeout(() => {
                inputRef.current?.focus();
            }, 0);
        }
        parentHandleSignIn();
    }, [password, errorMessage, parentHandleSignIn]);

    return (
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
                        theme={theme as 'light' | 'dark'}
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
            <View style={styles.modernInputContainer}>
                <TextField
                    ref={inputRef}
                    label="Password"
                    leading={<Ionicons name="lock-closed-outline" size={24} color={colors.secondaryText} />}
                    value={password}
                    onChangeText={handlePasswordChange}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="password-input"
                    variant="filled"
                    error={errorMessage || undefined}
                    onSubmitEditing={handleSignIn}
                    autoFocus
                />
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={[styles.footerText, { color: colors.text }]}>Forgot your password? </Text>
                    <TouchableOpacity onPress={() => navigate('RecoverAccount')}>
                        <Text style={[styles.modernLinkText, { color: colors.primary }]}>Recover your account</Text>
                    </TouchableOpacity>
                </View>
            </View>
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
            <StatusBar
                barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />
        </Animated.View>
    );
};

export default SignInPasswordStep; 