import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { useRef, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, type TextInput, StatusBar } from 'react-native';
import Animated, {
    useAnimatedStyle,
    SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../../components/Avatar';
import { useI18n } from '../../hooks/useI18n';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';

interface SignInPasswordStepProps {
    styles: any;
    fadeAnim: SharedValue<number>;
    slideAnim: SharedValue<number>;
    scaleAnim: SharedValue<number>;
    colors: any;
    userProfile: any;
    username: string;
    theme: string;
    logoAnim: SharedValue<number>;
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
    navigate: (screen: RouteName, props?: Record<string, any>) => void;
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
    navigate,
}) => {
    const inputRef = useRef<TextInput>(null);
    const { t } = useI18n();

    // Animated styles - properly memoized to prevent re-renders
    const containerAnimatedStyle = useAnimatedStyle(() => {
        return {
            opacity: fadeAnim.value,
            transform: [
                { translateX: slideAnim.value },
                { scale: scaleAnim.value }
            ]
        };
    });

    const logoAnimatedStyle = useAnimatedStyle(() => {
        return {
            transform: [{ scale: logoAnim.value }]
        };
    });

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
            containerAnimatedStyle
        ]}>
            <View style={styles.modernUserProfileContainer}>
                <Animated.View style={[
                    styles.avatarContainer,
                    logoAnimatedStyle
                ]}>
                    <Avatar
                        name={userProfile?.displayName || userProfile?.name || username}
                        size={100}
                        theme={theme as 'light' | 'dark'}
                        style={styles.modernUserAvatar}
                        backgroundColor={colors.primary + '20'}
                    />
                    <View style={[styles.statusIndicator, { backgroundColor: colors.primary }]} />
                </Animated.View>
                <Text style={[styles.modernUserDisplayName, { color: colors.text }]}>
                    {userProfile?.displayName || userProfile?.name || username}
                </Text>
                <Text style={[styles.modernUsernameSubtext, { color: colors.secondaryText }]}>
                    @{username}
                </Text>
            </View>
            <View style={styles.modernInputContainer}>
                <TextField
                    ref={inputRef}
                    label={t('common.labels.password')}
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
                    <Text style={[styles.footerText, { color: colors.text }]}>{t('signin.forgotPrompt') || 'Forgot your password?'} </Text>
                    <TouchableOpacity onPress={() => navigate('RecoverAccount', {
                        returnTo: 'SignIn',
                        returnStep: 1,
                        returnData: { username, userProfile }
                    })}>
                        <Text style={[styles.modernLinkText, { color: colors.primary }]}>{t('common.links.recoverAccount')}</Text>
                    </TouchableOpacity>
                </View>
            </View>
            <GroupedPillButtons
                buttons={[
                    {
                        text: t('common.actions.back'),
                        onPress: prevStep,
                        icon: 'arrow-back',
                        variant: 'transparent',
                    },
                    {
                        text: t('common.actions.signIn'),
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
                    {t('signin.security.dataSecure') || 'Your data is encrypted and secure'}
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
