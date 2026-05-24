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
