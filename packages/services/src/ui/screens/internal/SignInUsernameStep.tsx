import React from 'react';
import { View, Text, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HighFive from '../../../assets/illustrations/HighFive';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';

interface SignInUsernameStepProps {
    styles: any;
    fadeAnim: Animated.Value;
    slideAnim: Animated.Value;
    scaleAnim: Animated.Value;
    colors: any;
    isAddAccountMode: boolean;
    user: any;
    errorMessage: string;
    inputScaleAnim: Animated.Value;
    isInputFocused: boolean;
    username: string;
    validationStatus: 'idle' | 'validating' | 'valid' | 'invalid';
    userProfile: any;
    isValidating: boolean;
    handleInputFocus: () => void;
    handleInputBlur: () => void;
    handleUsernameChange: (text: string) => void;
    handleUsernameContinue: () => void;
    navigate: any;
}

const SignInUsernameStep: React.FC<SignInUsernameStepProps> = ({
    styles,
    fadeAnim,
    slideAnim,
    scaleAnim,
    colors,
    isAddAccountMode,
    user,
    errorMessage,
    inputScaleAnim,
    isInputFocused,
    username,
    validationStatus,
    userProfile,
    isValidating,
    handleInputFocus,
    handleInputBlur,
    handleUsernameChange,
    handleUsernameContinue,
    navigate,
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
        <HighFive width={100} height={100} />
        <View style={styles.modernHeader}>
            <Text style={[styles.modernTitle, { color: colors.text }]}>
                {isAddAccountMode ? 'Add Another Account' : 'Sign In'}
            </Text>
            <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                {isAddAccountMode
                    ? 'Sign in with another account'
                    : 'Sign in to continue your journey'
                }
            </Text>
        </View>
        {isAddAccountMode && (
            <View style={[styles.modernInfoCard, { backgroundColor: colors.inputBackground }]}>
                <Ionicons name="information-circle" size={20} color={colors.primary} />
                <Text style={[styles.modernInfoText, { color: colors.text }]}>
                    Currently signed in as <Text style={{ fontWeight: 'bold' }}>{user?.username}</Text>
                </Text>
            </View>
        )}
        <Animated.View style={[
            styles.modernInputContainer,
            { transform: [{ scale: inputScaleAnim }] }
        ]}>
            <TextField
                label="Username"
                icon="person-outline"
                value={username}
                onChangeText={handleUsernameChange}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                autoCapitalize="none"
                autoCorrect={false}
                testID="username-input"
                colors={colors}
                variant="filled"
                error={errorMessage || undefined}
                loading={isValidating}
                success={validationStatus === 'valid'}
            />
        </Animated.View>
        {validationStatus === 'valid' && userProfile && (
            <View style={[styles.validationSuccessCard, {
                backgroundColor: colors.success + '10',
                borderWidth: 1,
                borderColor: colors.success + '30',
                padding: 16,
            }]}>
                <View style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: colors.success + '20',
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginRight: 12,
                }}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.validationText, {
                        color: colors.success,
                        fontWeight: '600',
                        marginBottom: 2,
                    }]}>
                        Welcome back, {userProfile?.displayName || userProfile?.name || username}!
                    </Text>
                    <Text style={[styles.validationText, {
                        color: colors.secondaryText,
                        fontSize: 11,
                        opacity: 0.8,
                    }]}>
                        Ready to continue where you left off
                    </Text>
                </View>
            </View>
        )}
        <GroupedPillButtons
            buttons={[
                {
                    text: 'Sign Up',
                    onPress: () => navigate('SignUp'),
                    icon: 'person-add',
                    variant: 'transparent',
                },
                {
                    text: 'Continue',
                    onPress: handleUsernameContinue,
                    icon: 'arrow-forward',
                    variant: 'primary',
                    loading: isValidating,
                    testID: 'username-next-button',
                },
            ]}
            colors={colors}
        />
    </Animated.View>
);

export default SignInUsernameStep; 