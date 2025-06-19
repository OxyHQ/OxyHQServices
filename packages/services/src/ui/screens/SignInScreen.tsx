import React, { useState, useRef, useEffect } from 'react';
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
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const inputScaleAnim = useRef(new Animated.Value(1)).current;
    const logoAnim = useRef(new Animated.Value(0)).current;
    const progressAnim = useRef(new Animated.Value(0.5)).current;

    const { login, isLoading, user, isAuthenticated, sessions } = useOxy();

    const colors = useThemeColors(theme);
    const commonStyles = createCommonStyles(theme);

    // Check if this should be treated as "Add Account" mode
    const isAddAccountMode = user && isAuthenticated && sessions && sessions.length > 0;

    // Initialize logo animation
    useEffect(() => {
        Animated.spring(logoAnim, {
            toValue: 1,
            tension: 50,
            friction: 8,
            useNativeDriver: true,
        }).start();
    }, []);

    // Input focus animations
    const handleInputFocus = () => {
        setIsInputFocused(true);
        Animated.spring(inputScaleAnim, {
            toValue: 1.02,
            useNativeDriver: true,
        }).start();
    };

    const handleInputBlur = () => {
        setIsInputFocused(false);
        Animated.spring(inputScaleAnim, {
            toValue: 1,
            useNativeDriver: true,
        }).start();
    };

    // Animation functions
    const animateTransition = (nextStep: number) => {
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
    };

    const nextStep = () => {
        if (currentStep < 1) {
            // Animate progress bar
            Animated.timing(progressAnim, {
                toValue: 1.0,
                duration: 300,
                useNativeDriver: false,
            }).start();
            
            animateTransition(currentStep + 1);
        }
    };

    const prevStep = () => {
        if (currentStep > 0) {
            // Animate progress bar
            Animated.timing(progressAnim, {
                toValue: 0.5,
                duration: 300,
                useNativeDriver: false,
            }).start();
            
            animateTransition(currentStep - 1);
        }
    };

    // Fetch user profile when username is entered
    useEffect(() => {
        const fetchUserProfile = async () => {
            if (username.length >= 3 && currentStep === 1) {
                try {
                    // For now, we'll create a mock profile based on username
                    // In a real app, you'd fetch this from your API
                    setUserProfile({
                        displayName: username,
                        name: username,
                        avatar: null, // Could be fetched from API
                    });
                } catch (error) {
                    // If user not found, we'll show a generic avatar
                    setUserProfile(null);
                }
            }
        };

        fetchUserProfile();
    }, [username, currentStep]);

    const handleUsernameNext = () => {
        if (!username) {
            toast.error('Please enter your username');
            return;
        }
        setErrorMessage('');
        nextStep();
    };

    const handleLogin = async () => {
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
    };

    // Step components
    const renderUsernameStep = () => (
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
                <View style={[styles.inputWrapper, { borderColor: isInputFocused ? colors.primary : colors.border }]}>
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
                        onChangeText={setUsername}
                        onFocus={handleInputFocus}
                        onBlur={handleInputBlur}
                        autoCapitalize="none"
                        testID="username-input"
                    />
                </View>
            </Animated.View>

            <TouchableOpacity
                style={[
                    styles.modernButton, 
                    { 
                        backgroundColor: colors.primary,
                        opacity: !username ? 0.5 : 1,
                        shadowColor: colors.primary,
                    }
                ]}
                onPress={handleUsernameNext}
                disabled={!username}
                testID="username-next-button"
            >
                <Text style={styles.modernButtonText}>Continue</Text>
                <Ionicons name="arrow-forward" size={20} color="#FFFFFF" style={styles.buttonIcon} />
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
    );

    const renderPasswordStep = () => (
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
                        onChangeText={setPassword}
                        onFocus={handleInputFocus}
                        onBlur={handleInputBlur}
                        secureTextEntry={!showPassword}
                        testID="password-input"
                    />
                    <TouchableOpacity onPress={() => setShowPassword(prev => !prev)} style={styles.passwordToggle}>
                        <Ionicons
                            name={showPassword ? 'eye-off' : 'eye'}
                            size={20}
                            color={isInputFocused ? colors.primary : colors.secondaryText}
                        />
                    </TouchableOpacity>
                </View>
            </Animated.View>

            <TouchableOpacity
                style={[
                    styles.modernButton, 
                    { 
                        backgroundColor: colors.primary,
                        opacity: isLoading ? 0.8 : 1,
                        shadowColor: colors.primary,
                    }
                ]}
                onPress={handleLogin}
                disabled={isLoading}
                testID="login-button"
            >
                {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                    <>
                        <Text style={styles.modernButtonText}>
                            {isAddAccountMode ? 'Add Account' : 'Sign In'}
                        </Text>
                        <Ionicons name="arrow-forward" size={20} color="#FFFFFF" style={styles.buttonIcon} />
                    </>
                )}
            </TouchableOpacity>

            <View style={styles.modernNavigationButtons}>
                <TouchableOpacity
                    style={[styles.modernBackButton, { borderColor: colors.border }]}
                    onPress={prevStep}
                >
                    <Ionicons name="chevron-back" size={20} color={colors.text} />
                    <Text style={[styles.modernBackButtonText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>
            </View>

            {/* Security notice */}
            <View style={styles.securityNotice}>
                <Ionicons name="shield-checkmark" size={16} color={colors.secondaryText} />
                <Text style={[styles.securityText, { color: colors.secondaryText }]}>
                    Your connection is secure and encrypted
                </Text>
            </View>
        </Animated.View>
    );

    const renderCurrentStep = () => {
        switch (currentStep) {
            case 0:
                return renderUsernameStep();
            case 1:
                return renderPasswordStep();
            default:
                return renderUsernameStep();
        }
    };

    return (
        <BottomSheetScrollView
            contentContainerStyle={commonStyles.scrollContainer}
            keyboardShouldPersistTaps="handled"
        >
            <Animated.View style={[
                styles.logoContainer,
                { transform: [{ scale: logoAnim }] }
            ]}>
                <OxyLogo
                    style={{ marginBottom: 24 }}
                    width={50}
                    height={50}
                />
            </Animated.View>
            
            {/* Modern Progress indicator */}
            <View style={styles.modernProgressContainer}>
                <View style={styles.progressTrack}>
                    <Animated.View 
                        style={[
                            styles.progressFill,
                            { 
                                backgroundColor: colors.primary,
                                width: progressAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: ['50%', '100%']
                                })
                            }
                        ]} 
                    />
                </View>
                <Text style={[styles.progressText, { color: colors.secondaryText }]}>
                    Step {currentStep + 1} of 2
                </Text>
            </View>

            {renderCurrentStep()}
        </BottomSheetScrollView>
    );
};

const styles = StyleSheet.create({
    // Legacy styles (keeping for compatibility)
    title: {
        fontFamily: Platform.OS === 'web'
            ? 'Phudu'  
            : 'Phudu-Bold',  
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  
        fontSize: 54,
        marginBottom: 24,
    },
    formContainer: {
        width: '100%',
    },
    inputContainer: {
        marginBottom: 16,
    },
    label: {
        fontSize: 14,
        fontWeight: '500' as TextStyle['fontWeight'],
        marginBottom: 8,
    },
    footerTextContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
    },
    footerText: {
        fontSize: 14,
        lineHeight: 20,
    },
    linkText: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '600',
    },
    userInfoContainer: {
        padding: 20,
        marginVertical: 20,
        borderRadius: 35,
        alignItems: 'center',
    },
    userInfoText: {
        fontSize: 16,
        lineHeight: 24,
        textAlign: 'center',
    },
    actionButtonsContainer: {
        marginTop: 20,
    },
    infoContainer: {
        padding: 16,
        marginVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    infoText: {
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
    },

    // Modern UI Styles
    logoContainer: {
        alignItems: 'center',
        marginBottom: 16,
    },
    modernProgressContainer: {
        alignItems: 'center',
        marginBottom: 40,
        paddingHorizontal: 20,
    },
    progressTrack: {
        width: '100%',
        height: 4,
        backgroundColor: '#E5E5E5',
        borderRadius: 2,
        marginBottom: 8,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 2,
    },
    progressText: {
        fontSize: 12,
        fontWeight: '500',
    },
    stepContainer: {
        width: '100%',
        minHeight: 450,
        paddingHorizontal: 20,
    },

    // Modern Image Container
    modernImageContainer: {
        alignItems: 'center',
        marginBottom: 40,
        paddingVertical: 20,
    },
    modernHeader: {
        alignItems: 'center',
        marginBottom: 24,
    },
    modernTitle: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 54,
        textAlign: 'center',
        marginBottom: 8,
        letterSpacing: -0.5,
    },
    modernSubtitle: {
        fontSize: 16,
        lineHeight: 22,
        textAlign: 'center',
        opacity: 0.8,
    },

    // Modern Cards
    modernInfoCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginVertical: 16,
        borderRadius: 12,
        gap: 12,
    },
    modernInfoText: {
        fontSize: 14,
        lineHeight: 20,
        flex: 1,
    },
    modernErrorCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginVertical: 16,
        borderRadius: 12,
        gap: 12,
    },
    errorText: {
        fontSize: 14,
        lineHeight: 20,
        flex: 1,
    },

    // Modern Input Styles
    modernInputContainer: {
        marginBottom: 24,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 2,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 4,
        backgroundColor: 'rgba(0,0,0,0.02)',
    },
    inputIcon: {
        marginRight: 12,
    },
    passwordToggle: {
        paddingHorizontal: 4,
        paddingVertical: 4,
    },
    modernInput: {
        flex: 1,
        fontSize: 16,
        paddingVertical: 16,
        fontWeight: '500',
    },

    // Modern Button Styles
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

    // Legacy compatibility styles
    progressContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 32,
        paddingHorizontal: 40,
    },
    progressDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        marginHorizontal: 4,
    },
    progressLine: {
        flex: 1,
        height: 2,
        marginHorizontal: 8,
    },
    welcomeImageContainer: {
        alignItems: 'center',
        marginBottom: 32,
    },
    header: {
        alignItems: 'center',
        marginBottom: 16,
    },
    welcomeTitle: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 32,
        textAlign: 'center',
        marginBottom: 8,
    },
    welcomeText: {
        fontSize: 16,
        lineHeight: 24,
        textAlign: 'center',
        marginBottom: 32,
        paddingHorizontal: 20,
    },
    userProfileContainer: {
        alignItems: 'center',
        marginBottom: 32,
        paddingVertical: 20,
    },
    userAvatar: {
        marginBottom: 16,
    },
    userDisplayName: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 4,
        textAlign: 'center',
    },
    usernameSubtext: {
        fontSize: 16,
        textAlign: 'center',
    },
    navigationButtons: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 12,
        borderWidth: 1,
    },
    backButtonText: {
        fontSize: 16,
        fontWeight: '500',
        marginLeft: 8,
    },
});

export default SignInScreen;
