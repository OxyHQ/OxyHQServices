import { Platform, StyleSheet, TextStyle } from 'react-native';
import { fontFamilies } from './fonts';

export interface AuthThemeColors {
  text: string;
  background: string;
  inputBackground: string;
  placeholder: string;
  primary: string;
  border: string;
  error: string;
  success: string;
  warning: string;
  secondaryText: string;
}

export const createAuthStyles = (colors: AuthThemeColors, theme: string) => StyleSheet.create({
  // Container and scrollContent styles removed entirely
  // All layout is handled by BottomSheetRouter's BottomSheetScrollView
  // StepBasedScreen and step components are pure content renderers
  stepContainer: {
    // Removed flex: 1 - BottomSheetScrollView handles all layout
    // This prevents unnecessary expansion that can cause spacing issues
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },

  // Header styles
  modernHeader: {
    alignItems: 'flex-start',
    width: '100%',
    marginBottom: 24,
  },
  modernTitle: {
    fontFamily: fontFamilies.interBold,
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
    fontSize: 62,
    lineHeight: 74.4, // 62 * 1.2
    marginBottom: 18,
    textAlign: 'left',
    letterSpacing: -1,
  },
  modernSubtitle: {
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'left',
    opacity: 0.8,
  },
  welcomeTitle: {
    fontFamily: fontFamilies.interBold,
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
    fontSize: 42,
    lineHeight: 50.4, // 42 * 1.2
    marginBottom: 12,
    textAlign: 'left',
    letterSpacing: -1,
  },
  stepTitle: {
    fontFamily: fontFamilies.interBold,
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
    fontSize: 42,
    lineHeight: 50.4, // 42 * 1.2
    marginBottom: 12,
    textAlign: 'left',
    letterSpacing: -1,
  },

  // Info and error cards
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

  // Input styles
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
  premiumInputWrapper: {
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
  inputContent: {
    flex: 1,
  },
  modernInput: {
    flex: 1,
    fontSize: 16,
    height: '100%',
  },
  passwordToggle: {
    padding: 4,
  },

  // Validation styles
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
  validationCard: {
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
  belowInputMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 0,
    gap: 6,
  },
  belowInputText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Button styles
  modernButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 32,
    borderRadius: 16,
    marginVertical: 8,
    ...Platform.select({
      web: {
        boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
      },
      default: {
        shadowOffset: {
          width: 0,
          height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
      }
    }),
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

  // Label and link styles
  modernLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 2,
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
    marginTop: 16,
  },
  footerText: {
    fontSize: 15,
  },

  // User profile styles
  modernUserProfileContainer: {
    alignItems: 'flex-start',
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
    fontFamily: fontFamilies.interBold,
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
    fontSize: 42,
    marginBottom: 4,
    textAlign: 'left',
    letterSpacing: -0.5,
  },
  modernUsernameSubtext: {
    fontSize: 20,
    textAlign: 'left',
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

  // Navigation styles
  modernNavigationButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
    marginBottom: 8,
    width: '100%',
    gap: 8,
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

  // Security notice
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

  // Welcome image container
  welcomeImageContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 20,
  },
  welcomeText: {
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'left',
    opacity: 0.8,
    marginBottom: 24,
  },
  
  // Success styles
  successCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
    gap: 12,
    width: '100%',
  },
  successText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
}); 