import { StyleSheet } from 'react-native';

/**
 * Shared spacing constants for authentication screens
 * These values ensure consistent vertical spacing across all step components
 * All gaps between elements (illustration, title, description, textfield, buttons, etc.) use this value
 */
export const STEP_GAP = 12; // Vertical gap between ALL elements (illustration, title, description, textfield, buttons, etc.) - must be consistent everywhere
export const STEP_INNER_GAP = 12; // Gap within sections (headers, cards, etc.) - must match STEP_GAP for uniformity

/**
 * Reusable stylesheet for step components
 * All step components should use these base styles for consistency
 */
export const stepStyles = StyleSheet.create({
    container: {
        width: '100%',
        maxWidth: 420,
        alignSelf: 'center',
    },
    sectionSpacing: {
        marginBottom: STEP_GAP,
    },
    header: {
        alignItems: 'flex-start',
        width: '100%',
        gap: STEP_INNER_GAP,
    },
    title: {
        textAlign: 'left',
        marginBottom: 0,
        marginTop: 0,
    },
    subtitle: {
        textAlign: 'left',
        maxWidth: 320,
        alignSelf: 'flex-start',
        marginBottom: 0,
        marginTop: 0,
    },
    buttonContainer: {
        marginTop: 0,
        marginBottom: 0,
    },
});

