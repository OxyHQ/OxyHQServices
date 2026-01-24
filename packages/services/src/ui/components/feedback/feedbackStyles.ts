import { StyleSheet, Platform, Dimensions } from 'react-native';
import { screenContentStyle } from '../../constants/spacing';
import { fontFamilies } from '../../styles/fonts';
import type { FeedbackColors } from './types';

export const createFeedbackStyles = (colors: FeedbackColors) => StyleSheet.create({
    container: {
        flex: 1,
    },
    fullBleed: {
        width: '100%',
        alignSelf: 'stretch',
    },
    scrollContent: {
        flexGrow: 1,
        ...screenContentStyle,
    },
    stepContainer: {
        flex: 1,
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
    },
    modernHeader: {
        alignItems: 'flex-start',
        width: '100%',
        marginBottom: 24,
    },
    stepTitle: {
        fontFamily: fontFamilies.interBold,
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
        marginBottom: 24,
    },
    inputContainer: {
        width: '100%',
        marginBottom: 24,
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
    textAreaWrapper: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        minHeight: 120,
        borderRadius: 16,
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderWidth: 2,
        backgroundColor: colors.inputBackground,
    },
    inputIcon: {
        marginRight: 12,
    },
    inputContent: {
        flex: 1,
    },
    modernLabel: {
        fontSize: 12,
        fontWeight: '500',
        marginBottom: 2,
    },
    modernInput: {
        flex: 1,
        fontSize: 16,
        height: '100%',
    },
    textArea: {
        flex: 1,
        fontSize: 16,
        textAlignVertical: 'top',
        minHeight: 80,
    },
    categoryContainer: {
        marginBottom: 24,
    },
    checkboxContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 24,
    },
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: 6,
        borderWidth: 2,
        marginRight: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxText: {
        fontSize: 16,
        flex: 1,
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 18,
        paddingHorizontal: 32,
        borderRadius: 16,
        marginVertical: 8,
        gap: 8,
        width: '100%',
        ...Platform.select({
            web: {
                boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
            },
            default: {
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 6,
            }
        }),
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    navigationButtons: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
        marginBottom: 8,
        width: '100%',
        gap: 8,
    },
    navButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
        paddingHorizontal: 12,
        gap: 6,
        minWidth: 70,
        borderWidth: 1,
        ...Platform.select({
            web: {
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            },
            default: {
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 4,
                elevation: 2,
            }
        }),
    },
    backButton: {
        backgroundColor: 'transparent',
        borderTopLeftRadius: 35,
        borderBottomLeftRadius: 35,
        borderTopRightRadius: 12,
        borderBottomRightRadius: 12,
    },
    nextButton: {
        backgroundColor: 'transparent',
        borderTopRightRadius: 35,
        borderBottomRightRadius: 35,
        borderTopLeftRadius: 12,
        borderBottomLeftRadius: 12,
    },
    navButtonText: {
        fontSize: 13,
        fontWeight: '500',
    },
    progressContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 20,
        marginTop: 8,
    },
    progressDot: {
        height: 10,
        width: 10,
        borderRadius: 5,
        marginHorizontal: 6,
        borderWidth: 2,
        borderColor: '#fff',
        ...Platform.select({
            web: {
                boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
            },
            default: {
                shadowColor: colors.primary,
                shadowOpacity: 0.08,
                shadowOffset: { width: 0, height: 1 },
                shadowRadius: 2,
                elevation: 1,
            }
        }),
    },
    summaryContainer: {
        padding: 0,
        marginBottom: 24,
        width: '100%',
    },
    summaryRow: {
        flexDirection: 'row',
        marginBottom: 10,
    },
    summaryLabel: {
        fontSize: 15,
        width: 90,
    },
    summaryValue: {
        fontSize: 15,
        fontWeight: '600',
        flex: 1,
    },
    successContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    successIcon: {
        marginBottom: 24,
    },
    successTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 12,
        textAlign: 'center',
    },
    successMessage: {
        fontSize: 16,
        textAlign: 'center',
        opacity: 0.8,
        marginBottom: 24,
    },
});
