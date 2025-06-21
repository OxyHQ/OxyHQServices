import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Platform,
    KeyboardAvoidingView,
    ScrollView,
    TextStyle,
    Animated,
    Dimensions,
    StatusBar,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies, useThemeColors, createCommonStyles } from '../styles';
import OxyLogo from '../components/OxyLogo';
import Avatar from '../components/Avatar';
import { BottomSheetScrollView } from '../components/bottomSheet';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { toast } from '../../lib/sonner';

const SignInScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    theme,
}) => {
    // Form data states
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [userProfile, setUserProfile] = useState<any>(null);
    const [showPassword, setShowPassword] = useState(false);

    // Multi-step form states
    const [currentStep, setCurrentStep] = useState(0);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [validationStatus, setValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');

    // Cache for validation results to prevent repeated API calls
    const validationCache = useRef<Map<string, { profile: any; timestamp: number }>>(new Map());

    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const inputScaleAnim = useRef(new Animated.Value(1)).current;
    const logoAnim = useRef(new Animated.Value(0)).current;
    const progressAnim = useRef(new Animated.Value(0.5)).current;

    const { login, isLoading, user, isAuthenticated, sessions, oxyServices } = useOxy();

    const colors = useThemeColors(theme);
    const commonStyles = createCommonStyles(theme);

    // Check if this should be treated as "Add Account" mode
    const isAddAccountMode = useMemo(() =>
        user && isAuthenticated && sessions && sessions.length > 0,
        [user, isAuthenticated, sessions]
    );

    // Memoized styles to prevent rerenders
    const styles = useMemo(() => createStyles(colors, theme), [colors, theme]);

    // Initialize logo animation
    useEffect(() => {
        Animated.spring(logoAnim, {
            toValue: 1,
            tension: 50,
            friction: 8,
            useNativeDriver: true,
        }).start();
    }, [logoAnim]);

    // Input focus animations
    const handleInputFocus = useCallback(() => {
        setIsInputFocused(true);
        Animated.spring(inputScaleAnim, {
            toValue: 1.02,
            useNativeDriver: true,
        }).start();
    }, [inputScaleAnim]);

    const handleInputBlur = useCallback(() => {
        setIsInputFocused(false);
        Animated.spring(inputScaleAnim, {
            toValue: 1,
            useNativeDriver: true,
        }).start();
    }, [inputScaleAnim]);

    // Memoized input change handlers to prevent re-renders
    const handleUsernameChange = useCallback((text: string) => {
        setUsername(text);
        // Only clear error if we're changing from an invalid state
        if (validationStatus === 'invalid') {
            setErrorMessage('');
            setValidationStatus('idle');
        }
    }, [validationStatus]);

    const handlePasswordChange = useCallback((text: string) => {
        setPassword(text);
        setErrorMessage(''); // Clear error when user types
    }, []);

    // Username validation using core services with caching
    const validateUsername = useCallback(async (usernameToValidate: string) => {
        if (!usernameToValidate || usernameToValidate.length < 3) {
            setValidationStatus('invalid');
            return false;
        }

        // Check cache first (cache valid for 5 minutes)
        const cached = validationCache.current.get(usernameToValidate);
        const now = Date.now();
        if (cached && (now - cached.timestamp) < 5 * 60 * 1000) {
            setUserProfile(cached.profile);
            setValidationStatus('valid');
            setErrorMessage('');
            return true;
        }

        setIsValidating(true);
        setValidationStatus('validating');

        try {
            // First check if username exists by trying to get profile
            const profile = await oxyServices.getUserProfileByUsername(usernameToValidate);

            if (profile) {
                const profileData = {
                    displayName: profile.name?.full || profile.name?.first || profile.username,
                    name: profile.username,
                    avatar: profile.avatar,
                    id: profile.id
                };

                setUserProfile(profileData);
                setValidationStatus('valid');
                setErrorMessage(''); // Clear any previous errors

                // Cache the result
                validationCache.current.set(usernameToValidate, {
                    profile: profileData,
                    timestamp: now
                });

                return true;
            } else {
                setValidationStatus('invalid');
                setErrorMessage('Username not found. Please check your username or sign up.');
                return false;
            }
        } catch (error: any) {
            // If user not found (404), username doesn't exist
            if (error.status === 404 || error.code === 'USER_NOT_FOUND') {
                setValidationStatus('invalid');
                setErrorMessage('Username not found. Please check your username or sign up.');
                return false;
            }

            // For other errors, show generic message
            console.error('Username validation error:', error);
            setValidationStatus('invalid');
            setErrorMessage('Unable to validate username. Please try again.');
            return false;
        } finally {
            setIsValidating(false);
        }
    }, [oxyServices]);

    // Debounced username validation - increased debounce time and added better conditions
    useEffect(() => {
        if (!username || username.length < 3) {
            setValidationStatus('idle');
            setUserProfile(null);
            setErrorMessage(''); // Clear error when input is too short
            return;
        }

        // Only validate if we haven't already validated this exact username
        if (validationStatus === 'valid' && userProfile?.name === username) {
            return;
        }

        const timeoutId = setTimeout(() => {
            validateUsername(username);
        }, 800); // Increased debounce to 800ms

        return () => clearTimeout(timeoutId);
    }, [username, validateUsername, validationStatus, userProfile?.name]);

    // Cleanup cache on unmount and limit cache size
    useEffect(() => {
        return () => {
            // Clear cache on unmount
            validationCache.current.clear();
        };
    }, []);

    // Clean up old cache entries periodically (older than 10 minutes)
    useEffect(() => {
        const cleanupInterval = setInterval(() => {
            const now = Date.now();
            const maxAge = 10 * 60 * 1000; // 10 minutes

            for (const [key, value] of validationCache.current.entries()) {
                if (now - value.timestamp > maxAge) {
                    validationCache.current.delete(key);
                }
            }

            // Limit cache size to 50 entries
            if (validationCache.current.size > 50) {
                const entries = Array.from(validationCache.current.entries());
                entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
                const toDelete = entries.slice(0, entries.length - 50);
                toDelete.forEach(([key]) => validationCache.current.delete(key));
            }
        }, 5 * 60 * 1000); // Clean up every 5 minutes

        return () => clearInterval(cleanupInterval);
    }, []);

    // Animation functions
    const animateTransition = useCallback((nextStep: number) => {
        // Scale down current content
        Animated.timing(scaleAnim, {
            toValue: 0.95,
            duration: 150,
            useNativeDriver: true,
        }).start();

        // Fade out
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
        }).start(() => {
            setCurrentStep(nextStep);

            // Reset animations
            slideAnim.setValue(-50);
            scaleAnim.setValue(0.95);

            // Animate in new content
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }),
                Animated.spring(slideAnim, {
                    toValue: 0,
                    tension: 80,
                    friction: 8,
                    useNativeDriver: true,
                }),
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    tension: 80,
                    friction: 8,
                    useNativeDriver: true,
                })
            ]).start();
        });
    }, [fadeAnim, slideAnim, scaleAnim]);

    const nextStep = useCallback(() => {
        if (currentStep < 1) {
            // Animate progress bar
            Animated.timing(progressAnim, {
                toValue: 1.0,
                duration: 300,
                useNativeDriver: false,
            }).start();

            animateTransition(currentStep + 1);
        }
    }, [currentStep, progressAnim, animateTransition]);

    const prevStep = useCallback(() => {
        if (currentStep > 0) {
            // Animate progress bar
            Animated.timing(progressAnim, {
                toValue: 0.5,
                duration: 300,
                useNativeDriver: false,
            }).start();

            animateTransition(currentStep - 1);
        }
    }, [currentStep, progressAnim, animateTransition]);

    const handleUsernameNext = useCallback(() => {
        if (!username) {
            toast.error('Please enter your username');
            return;
        }

        if (validationStatus === 'invalid') {
            // Don't show toast if we already have an error message displayed
            if (!errorMessage) {
                toast.error('Please enter a valid username');
            }
            return;
        }

        if (validationStatus === 'validating') {
            toast.error('Please wait while we validate your username');
            return;
        }

        if (validationStatus === 'valid' && userProfile) {
            setErrorMessage('');
            nextStep();
        } else {
            toast.error('Please enter a valid username');
        }
    }, [username, validationStatus, userProfile, errorMessage, nextStep]);

    const handleLogin = useCallback(async () => {
        if (!username || !password) {
            toast.error('Please enter both username and password');
            return;
        }

        try {
            setErrorMessage('');
            await login(username, password);
            // The authentication state change will be handled through context
        } catch (error: any) {
            toast.error(error.message || 'Login failed');
        }
    }, [username, password, login]);

    // Memoized step components
    const renderUsernameStep = useMemo(() => (
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
            <View style={styles.modernImageContainer}>
                <Svg width={280} height={160} viewBox="0 0 280 160">
                    <Defs>
                        <LinearGradient id="primaryGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <Stop offset="0%" stopColor={colors.primary} stopOpacity="0.8" />
                            <Stop offset="100%" stopColor={colors.primary} stopOpacity="0.2" />
                        </LinearGradient>
                        <LinearGradient id="secondaryGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <Stop offset="0%" stopColor={colors.primary} stopOpacity="0.1" />
                            <Stop offset="100%" stopColor={colors.primary} stopOpacity="0.3" />
                        </LinearGradient>
                    </Defs>

                    {/* Modern abstract shapes */}
                    <Circle cx="80" cy="80" r="45" fill="url(#primaryGradient)" />
                    <Circle cx="200" cy="80" r="35" fill="url(#secondaryGradient)" />
                    <Path
                        d="M40 120 Q80 40 140 80 Q200 120 240 60"
                        stroke={colors.primary}
                        strokeWidth="4"
                        fill="none"
                        strokeLinecap="round"
                    />

                    {/* Floating elements */}
                    <Circle cx="60" cy="50" r="8" fill={colors.primary} opacity="0.6" />
                    <Circle cx="220" cy="120" r="6" fill={colors.primary} opacity="0.4" />
                    <Circle cx="250" cy="40" r="4" fill={colors.primary} opacity="0.8" />

                    {/* Central focus element */}
                    <Circle cx="140" cy="80" r="25" fill={colors.background} opacity="0.9" />
                    <Circle cx="135" cy="75" r="3" fill={colors.primary} />
                    <Circle cx="145" cy="75" r="3" fill={colors.primary} />
                    <Path
                        d="M132 85 Q140 92 148 85"
                        stroke={colors.primary}
                        strokeWidth="2"
                        fill="none"
                        strokeLinecap="round"
                    />
                </Svg>
            </View>

            <View style={styles.modernHeader}>
                <Text style={[styles.modernTitle, { color: colors.text }]}>
                    {isAddAccountMode ? 'Add Account' : 'Welcome Back'}
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

            {errorMessage ? (
                <Animated.View style={[styles.modernErrorCard, { backgroundColor: '#FF6B6B20' }]}>
                    <Ionicons name="alert-circle" size={20} color="#FF6B6B" />
                    <Text style={[styles.errorText, { color: '#FF6B6B' }]}>{errorMessage}</Text>
                </Animated.View>
            ) : null}

            <Animated.View style={[
                styles.modernInputContainer,
                { transform: [{ scale: inputScaleAnim }] }
            ]}>
                <View style={[
                    styles.inputWrapper,
                    {
                        borderColor: validationStatus === 'valid' ? colors.success :
                            validationStatus === 'invalid' ? colors.error :
                                isInputFocused ? colors.primary : colors.border
                    }
                ]}>
                    <Ionicons
                        name="person-outline"
                        size={20}
                        color={isInputFocused ? colors.primary : colors.secondaryText}
                        style={styles.inputIcon}
                    />
                    <TextInput
                        style={[styles.modernInput, { color: colors.text }]}
                        placeholder="Enter your username"
                        placeholderTextColor={colors.placeholder}
                        value={username}
                        onChangeText={handleUsernameChange}
                        onFocus={handleInputFocus}
                        onBlur={handleInputBlur}
                        autoCapitalize="none"
                        testID="username-input"
                    />
                    {validationStatus === 'validating' && (
                        <ActivityIndicator size="small" color={colors.primary} style={styles.validationIndicator} />
                    )}
                    {validationStatus === 'valid' && (
                        <Ionicons name="checkmark-circle" size={20} color={colors.success} style={styles.validationIndicator} />
                    )}
                    {validationStatus === 'invalid' && username.length >= 3 && (
                        <Ionicons name="close-circle" size={20} color={colors.error} style={styles.validationIndicator} />
                    )}
                </View>

                {/* Validation feedback */}
                {validationStatus === 'valid' && userProfile && (
                    <View style={[styles.validationSuccessCard, { backgroundColor: colors.success + '15' }]}>
                        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                        <Text style={[styles.validationText, { color: colors.success }]}>
                            Found user: {userProfile.displayName}
                        </Text>
                    </View>
                )}

                {validationStatus === 'invalid' && username.length >= 3 && !errorMessage && (
                    <View style={[styles.validationErrorCard, { backgroundColor: colors.error + '15' }]}>
                        <Ionicons name="alert-circle" size={16} color={colors.error} />
                        <Text style={[styles.validationText, { color: colors.error }]}>
                            Username not found
                        </Text>
                    </View>
                )}
            </Animated.View>

            <TouchableOpacity
                style={[
                    styles.modernButton,
                    {
                        backgroundColor: colors.primary,
                        opacity: (!username || validationStatus !== 'valid') ? 0.5 : 1,
                        shadowColor: colors.primary,
                    }
                ]}
                onPress={handleUsernameNext}
                disabled={!username || validationStatus !== 'valid' || isValidating}
                testID="username-next-button"
            >
                {isValidating ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                    <>
                        <Text style={styles.modernButtonText}>Continue</Text>
                        <Ionicons name="arrow-forward" size={20} color="#FFFFFF" style={styles.buttonIcon} />
                    </>
                )}
            </TouchableOpacity>

            <View style={styles.footerTextContainer}>
                <Text style={[styles.footerText, { color: colors.secondaryText }]}>
                    Don't have an account?{' '}
                </Text>
                <TouchableOpacity onPress={() => navigate('SignUp')}>
                    <Text style={[styles.modernLinkText, { color: colors.primary }]}>Sign Up</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    ), [
        fadeAnim, slideAnim, scaleAnim, colors, isAddAccountMode, user?.username,
        errorMessage, inputScaleAnim, isInputFocused, username, validationStatus,
        userProfile, isValidating, handleInputFocus, handleInputBlur, handleUsernameChange,
        handleUsernameNext, navigate, styles
    ]);

    const renderPasswordStep = useMemo(() => (
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

            {errorMessage ? (
                <Animated.View style={[styles.modernErrorCard, { backgroundColor: '#FF6B6B20' }]}>
                    <Ionicons name="alert-circle" size={20} color="#FF6B6B" />
                    <Text style={[styles.errorText, { color: '#FF6B6B' }]}>{errorMessage}</Text>
                </Animated.View>
            ) : null}

            <Animated.View style={[
                styles.modernInputContainer,
                { transform: [{ scale: inputScaleAnim }] }
            ]}>
                <View style={[styles.inputWrapper, { borderColor: isInputFocused ? colors.primary : colors.border }]}>
                    <Ionicons
                        name="lock-closed-outline"
                        size={20}
                        color={isInputFocused ? colors.primary : colors.secondaryText}
                        style={styles.inputIcon}
                    />
                    <TextInput
                        style={[styles.modernInput, { color: colors.text }]}
                        placeholder="Enter your password"
                        placeholderTextColor={colors.placeholder}
                        value={password}
                        onChangeText={handlePasswordChange}
                        onFocus={handleInputFocus}
                        onBlur={handleInputBlur}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        testID="password-input"
                    />
                    <TouchableOpacity
                        style={styles.passwordToggle}
                        onPress={() => setShowPassword(!showPassword)}
                    >
                        <Ionicons
                            name={showPassword ? "eye-off" : "eye"}
                            size={20}
                            color={colors.secondaryText}
                        />
                    </TouchableOpacity>
                </View>
            </Animated.View>

            <TouchableOpacity
                style={[
                    styles.modernButton,
                    {
                        backgroundColor: colors.primary,
                        opacity: !password ? 0.5 : 1,
                        shadowColor: colors.primary,
                    }
                ]}
                onPress={handleLogin}
                disabled={!password || isLoading}
                testID="login-button"
            >
                {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                    <>
                        <Text style={styles.modernButtonText}>Sign In</Text>
                        <Ionicons name="log-in" size={20} color="#FFFFFF" style={styles.buttonIcon} />
                    </>
                )}
            </TouchableOpacity>

            <View style={styles.modernNavigationButtons}>
                <TouchableOpacity
                    style={[styles.modernBackButton, { borderColor: colors.border }]}
                    onPress={prevStep}
                >
                    <Ionicons name="arrow-back" size={18} color={colors.text} />
                    <Text style={[styles.modernBackButtonText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.securityNotice}>
                <Ionicons name="shield-checkmark" size={14} color={colors.secondaryText} />
                <Text style={[styles.securityText, { color: colors.secondaryText }]}>
                    Your data is encrypted and secure
                </Text>
            </View>
        </Animated.View>
    ), [
        fadeAnim, slideAnim, scaleAnim, colors, userProfile, username, theme, logoAnim,
        errorMessage, inputScaleAnim, isInputFocused, password, showPassword,
        handleInputFocus, handleInputBlur, handlePasswordChange, handleLogin, isLoading, prevStep, styles
    ]);

    const renderCurrentStep = useCallback(() => {
        switch (currentStep) {
            case 0:
                return renderUsernameStep;
            case 1:
                return renderPasswordStep;
            default:
                return renderUsernameStep;
        }
    }, [currentStep, renderUsernameStep, renderPasswordStep]);

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: colors.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <StatusBar
                barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {renderCurrentStep()}
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

// Memoized styles creation
const createStyles = (colors: any, theme: string) => StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingTop: 40,
        paddingBottom: 40,
    },
    stepContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 600,
    },
    modernImageContainer: {
        alignItems: 'center',
        marginBottom: 40,
    },
    modernHeader: {
        alignItems: 'flex-start',
        width: '100%',
        marginBottom: 32,
    },
    modernTitle: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 42,
        lineHeight: 48,
        marginBottom: 12,
        textAlign: 'left',
        letterSpacing: -1,
    },
    modernSubtitle: {
        fontSize: 18,
        lineHeight: 24,
        textAlign: 'left',
        opacity: 0.8,
    },
    modernInfoCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 16,
        marginBottom: 24,
        gap: 12,
        width: '100%',
    },
    modernInfoText: {
        fontSize: 14,
        flex: 1,
    },
    modernErrorCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 16,
        marginBottom: 24,
        gap: 12,
        width: '100%',
    },
    errorText: {
        fontSize: 14,
        fontWeight: '500',
        flex: 1,
    },
    modernInputContainer: {
        width: '100%',
        marginBottom: 24,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 56,
        borderRadius: 16,
        paddingHorizontal: 20,
        borderWidth: 2,
        backgroundColor: colors.inputBackground,
    },
    inputIcon: {
        marginRight: 12,
    },
    modernInput: {
        flex: 1,
        fontSize: 16,
        height: '100%',
    },
    passwordToggle: {
        padding: 4,
    },
    validationIndicator: {
        marginLeft: 8,
    },
    validationSuccessCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 12,
        marginTop: 8,
        gap: 8,
    },
    validationErrorCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 12,
        marginTop: 8,
        gap: 8,
    },
    validationText: {
        fontSize: 12,
        fontWeight: '500',
    },
    modernButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 18,
        paddingHorizontal: 32,
        borderRadius: 16,
        marginVertical: 8,
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
        gap: 8,
        width: '100%',
    },
    modernButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    buttonIcon: {
        marginLeft: 4,
    },
    modernLinkText: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '600',
        textDecorationLine: 'underline',
    },
    footerTextContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 28,
    },
    footerText: {
        fontSize: 15,
    },

    // Modern User Profile Styles
    modernUserProfileContainer: {
        alignItems: 'center',
        marginBottom: 32,
        paddingVertical: 24,
    },
    avatarContainer: {
        position: 'relative',
        marginBottom: 20,
    },
    modernUserAvatar: {
        borderWidth: 4,
        borderColor: 'rgba(209, 105, 229, 0.2)',
    },
    statusIndicator: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 3,
        borderColor: '#FFFFFF',
    },
    modernUserDisplayName: {
        fontSize: 26,
        fontWeight: '700',
        marginBottom: 4,
        textAlign: 'center',
        letterSpacing: -0.5,
    },
    modernUsernameSubtext: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 16,
        opacity: 0.7,
    },
    welcomeBackBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        gap: 6,
    },
    welcomeBackText: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },

    // Modern Navigation
    modernNavigationButtons: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
        marginBottom: 16,
    },
    modernBackButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 12,
        borderWidth: 1,
        gap: 8,
    },
    modernBackButtonText: {
        fontSize: 16,
        fontWeight: '500',
    },

    // Security Notice
    securityNotice: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 20,
        gap: 6,
    },
    securityText: {
        fontSize: 12,
        fontWeight: '500',
    },
});

export default SignInScreen;
