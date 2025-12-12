import { StyleSheet } from 'react-native';

/**
 * Shared spacing constants for authentication screens
 * These values ensure consistent vertical spacing across all step components
 * All gaps between elements (illustration, title, description, textfield, buttons, etc.) use this value
 */
export const STEP_GAP = 12; // Vertical gap between ALL elements (illustration, title, description, textfield, buttons, etc.) - must be consistent everywhere
export const STEP_INNER_GAP = 12; // Gap within sections (headers, cards, etc.) - must match STEP_GAP for uniformity

/**
 * Re-export screen spacing constants from constants/spacing.ts
 * This allows importing all spacing constants from a single location
 */
export {
    SCREEN_PADDING_HORIZONTAL,
    SCREEN_PADDING_VERTICAL,
    SECTION_GAP,
    SECTION_GAP_LARGE,
    COMPONENT_GAP,
    COMPONENT_GAP_SMALL,
    HEADER_PADDING_TOP_OVERVIEW,
    HEADER_PADDING_TOP_SETTINGS,
} from '../constants/spacing';

/**
 * Reusable stylesheet for step components
 * NOTE: Layout styles (container, sectionSpacing) removed - all layout is handled by BottomSheetRouter
 * Step components should NOT use these for layout, only for content-specific styling
 */
export const stepStyles = StyleSheet.create({
    container: {
        // Layout removed - use only for content width constraints if needed
        width: '100%',
        maxWidth: 420,
        alignSelf: 'center',
    },
    sectionSpacing: {
        // Layout removed - do NOT use for spacing, use explicit marginBottom: 0
        // This is kept for backward compatibility but should not add margins
        marginBottom: 0,
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

