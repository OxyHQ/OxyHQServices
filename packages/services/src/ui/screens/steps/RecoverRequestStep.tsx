import type React from 'react';
import { useRef } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HighFive from '../../../assets/illustrations/HighFive';
import TextField from '../../components/internal/TextField';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import { toast } from '../../../lib/sonner';
import type { OxyServices } from '../../../core';
import { useI18n } from '../../hooks/useI18n';

interface RecoverRequestStepProps {
    // Common props from StepBasedScreen
    colors: any;
    styles: any;
    theme: string;
    navigate: (screen: string, props?: Record<string, any>) => void;

    // Step navigation
    nextStep: () => void;
    currentStep: number;
    totalSteps: number;

    // Data management
    stepData?: any;
    updateStepData: (data: any) => void;

    // Form state
    identifier: string;
    setIdentifier: (identifier: string) => void;
    errorMessage: string;
    setErrorMessage: (message: string) => void;
    isLoading: boolean;
    setIsLoading: (loading: boolean) => void;
    oxyServices?: OxyServices;
}

const RecoverRequestStep: React.FC<RecoverRequestStepProps> = ({
    colors,
    styles,
    navigate,
    nextStep,
    identifier,
    setIdentifier,
    errorMessage,
    setErrorMessage,
    isLoading,
    setIsLoading,
    oxyServices,
}) => {
    const inputRef = useRef<any>(null);
    const { t } = useI18n();

    const handleIdentifierChange = (text: string) => {
        setIdentifier(text);
        if (errorMessage) setErrorMessage('');
    };

    const handleRequest = async () => {
        if (!identifier || identifier.length < 3) {
            setErrorMessage('Please enter your username.');
            setTimeout(() => inputRef.current?.focus(), 0);
            return;
        }

        setErrorMessage('');
        setIsLoading(true);

        try {
            toast.info('Email recovery is disabled. Use your authenticator app during sign-in or contact support.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleRequestWithFocus = () => {
        if (!identifier) {
            setTimeout(() => inputRef.current?.focus(), 0);
        }
        handleRequest();
    };

    return (
        <>
            <HighFive width={100} height={100} />
            <View style={styles.modernHeader}>
                <Text style={[styles.modernTitle, { color: colors.text }]}>{t('recover.title')}</Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>{t('recover.noEmail')}</Text>
            </View>

            <View style={styles.modernInputContainer}>
                <TextField
                    ref={inputRef}
                    label={t('recover.username.label')}
                    leading={<Ionicons name="mail-outline" size={24} color={colors.secondaryText} />}
                    value={identifier}
                    onChangeText={handleIdentifierChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="recover-identifier-input"
                    variant="filled"
                    error={errorMessage || undefined}
                    editable={!isLoading}
                    onSubmitEditing={handleRequestWithFocus}
                    autoFocus
                />
            </View>

            <GroupedPillButtons
                buttons={[
                    {
                        text: t('common.actions.back'),
                        onPress: () => navigate('SignIn'),
                        icon: 'arrow-back',
                        variant: 'transparent',
                    },
                    {
                        text: t('common.actions.continue'),
                        onPress: handleRequest,
                        icon: 'information-circle-outline',
                        variant: 'primary',
                        loading: isLoading,
                        disabled: isLoading,
                    },
                ]}
                colors={colors}
            />
        </>
    );
};

export default RecoverRequestStep;
