import React, { useRef } from 'react';
import { TextInput, View, Text, Animated } from 'react-native';
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
    isInputFocused,
    username,
    validationStatus,
    userProfile,
    isValidating,
    handleInputFocus,
    handleInputBlur,
    handleUsernameChange,
    handleUsernameContinue: parentHandleUsernameContinue,
    navigate,
}) => {
    const inputRef = useRef<TextInput>(null);
    const handleUsernameContinue = () => {
        if (!username || validationStatus === 'invalid') {
            setTimeout(() => {
                inputRef.current?.focus();
            }, 0);
        }
        parentHandleUsernameContinue();
    };
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
            <View style={styles.modernInputContainer}>
                <TextField
                    ref={inputRef}
                    label="Username"
                    leading={<Ionicons name="person-outline" size={24} color={colors.secondaryText} />}
                    value={username}
                    onChangeText={handleUsernameChange}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="username-input"
                    variant="filled"
                    error={validationStatus === 'invalid' ? errorMessage : undefined}
                    loading={validationStatus === 'validating'}
                    success={validationStatus === 'valid'}
                    onSubmitEditing={handleUsernameContinue}
                    autoFocus
                />
            </View>
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
};

export default SignInUsernameStep; 