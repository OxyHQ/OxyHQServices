import { Platform, type TextStyle } from 'react-native';

/**
 * Font family names for use across the app
 *
 * For web platforms, we use the CSS font name with weights
 * For native platforms, we use the specific static font file names
 */
export const fontFamilies = {
  // Regular weight (400)
  inter: Platform.select({
    web: 'Inter',  // Web projects will use standard CSS font name
    default: 'Inter-Regular'  // Native projects use the specific weight font
  }),

  // Light weight (300)
  interLight: Platform.select({
    web: 'Inter',  // Web uses CSS weight
    default: 'Inter-Light'  // Native uses specific font
  }),

  // Medium weight (500)
  interMedium: Platform.select({
    web: 'Inter',  // Web uses CSS weight
    default: 'Inter-Medium'  // Native uses specific font
  }),

  // SemiBold weight (600)
  interSemiBold: Platform.select({
    web: 'Inter',  // Web uses CSS weight
    default: 'Inter-SemiBold'  // Native uses specific font
  }),

  // Bold weight (700)
  interBold: Platform.select({
    web: 'Inter',  // Web uses CSS weight
    default: 'Inter-Bold'  // Native uses specific font
  }),

  // ExtraBold weight (800)
  interExtraBold: Platform.select({
    web: 'Inter',  // Web uses CSS weight
    default: 'Inter-ExtraBold'  // Native uses specific font
  }),

  // Black weight (900)
  interBlack: Platform.select({
    web: 'Inter',  // Web uses CSS weight
    default: 'Inter-Black'  // Native uses specific font
  }),
};

/**
 * Font styles that can be reused across the app
 */
export const fontStyles: Record<string, TextStyle> = {
  titleLarge: {
    fontFamily: fontFamilies.interBold,
    fontSize: 54,
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
  },
  titleMedium: {
    fontFamily: fontFamilies.interBold,
    fontSize: 24,
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
  },
  titleSmall: {
    fontFamily: fontFamilies.interBold,
    fontSize: 20,
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
  },
  buttonText: {
    fontFamily: fontFamilies.interSemiBold,
    fontSize: 16,
    fontWeight: Platform.OS === 'web' ? '600' : undefined,  // Only apply fontWeight on web
  },
};
