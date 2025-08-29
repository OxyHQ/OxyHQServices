import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { useRef, useEffect } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HighFive from '../../../assets/illustrations/HighFive';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';
import { useI18n } from '../../hooks/useI18n';

interface SignInUsernameStepProps {
    // Common props from StepBasedScreen
    colors: any;
    styles: any;
    theme: string;
    navigate: (screen: RouteName, props?: Record<string, any>) => void;

    // Step navigation
    nextStep: () => void;
    prevStep: () => void;
    currentStep: number;
    totalSteps: number;

    // Data management
    stepData?: any;
    updateStepData: (data: any) => void;
    allStepData: any[];

    // Form state
    username: string;
    setUsername: (username: string) => void;
    errorMessage: string;
    setErrorMessage: (message: string) => void;
    validationStatus: 'idle' | 'validating' | 'valid' | 'invalid';
    userProfile: any;
    isValidating: boolean;

    // Add account mode
    isAddAccountMode?: boolean;
    user?: any;

    // Validation function
    validateUsername: (username: string) => Promise<boolean>;
}

const SignInUsernameStep: React.FC<SignInUsernameStepProps> = ({
    colors,
    styles,
    navigate,
    nextStep,
    username,
    setUsername,
    errorMessage,
    setErrorMessage,
    validationStatus,
    userProfile,
    isValidating,
    isAddAccountMode,
    user,
    validateUsername,
}) => {
    const inputRef = useRef<any>(null);
    const { t } = useI18n();

    // Monitor username prop changes
    useEffect(() => {
        console.log('👀 SignInUsernameStep username prop changed:', username);
    }, [username]);

    const handleUsernameChange = (text: string) => {
        console.log('📝 Username input changed:', text);
        setUsername(text);
        if (errorMessage) setErrorMessage('');
    };

    const handleContinue = async () => {
        console.log('🚀 Continue button pressed, username:', username);

        const trimmedUsername = username?.trim() || '';

        if (!trimmedUsername) {
            console.log('❌ Username is empty');
            setErrorMessage('Please enter your username.');
            setTimeout(() => inputRef.current?.focus(), 0);
            return;
        }

        if (trimmedUsername.length < 2) {
            console.log('❌ Username too short');
            setErrorMessage('Username must be at least 3 characters.');
            return;
        }

        console.log('🔍 Starting username validation...');
        try {
            // Validate the username before proceeding
            const isValid = await validateUsername(trimmedUsername);
            console.log('📊 Validation result:', isValid);

            if (isValid) {
                console.log('✅ Validation passed, proceeding to next step');
                nextStep();
            } else {
                console.log('❌ Validation failed, staying on current step');
            }
        } catch (error) {
            console.error('🚨 Error during validation:', error);
            setErrorMessage('Unable to validate username. Please try again.');
        }
    };

    return (
        <>
            <HighFive width={100} height={100} />
            <View style={styles.modernHeader}>
                <Text style={[styles.modernTitle, { color: colors.text }]}>
                    {isAddAccountMode ? t('signin.addAccountTitle') : t('signin.title')}
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    {isAddAccountMode ? t('signin.addAccountSubtitle') : t('signin.subtitle')}
                </Text>
            </View>

            {isAddAccountMode && user && (
                <View style={[styles.modernInfoCard, { backgroundColor: colors.inputBackground }]}>
                    <Ionicons name="information-circle" size={20} color={colors.primary} />
                    <Text style={[styles.modernInfoText, { color: colors.text }]}>
                        {t('signin.currentlySignedInAs', { username: user.username }) || 'Currently signed in as '}
                        <Text style={{ fontWeight: 'bold' }}>{user.username}</Text>
                    </Text>
                </View>
            )}

            <View style={styles.modernInputContainer}>
                <TextField
                    ref={inputRef}
                    label={t('common.labels.username')}
                    leading={<Ionicons name="person-outline" size={24} color={colors.secondaryText} />}
                    value={username}
                    onChangeText={handleUsernameChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="username-input"
                    variant="filled"
                    error={validationStatus === 'invalid' ? errorMessage : undefined}
                    loading={validationStatus === 'validating'}
                    success={validationStatus === 'valid'}
                    onSubmitEditing={() => handleContinue()}
                    autoFocus
                />
            </View>

            <GroupedPillButtons
                buttons={[
                    {
                        text: t('common.links.signUp'),
                        onPress: () => navigate('SignUp'),
                        icon: 'person-add',
                        variant: 'transparent',
                    },
                    {
                        text: t('common.actions.continue'),
                        onPress: handleContinue,
                        icon: 'arrow-forward',
                        variant: 'primary',
                        loading: isValidating,
                        disabled: !username || username.trim().length < 2 || isValidating,
                        testID: 'username-next-button',
                    },
                ]}
                colors={colors}
            />
        </>
    );
};

export default SignInUsernameStep;
