import { Platform, TextStyle } from 'react-native';

/**
 * Font family names for use across the app
 * 
 * For web platforms, we need to use the CSS font name
 * For native platforms, we use the PostScript name of the font file
 */
export const fontFamilies = {
  phudu: Platform.select({
    web: 'Phudu',  // Web projects will use standard CSS font name
    default: 'Phudu-Variable'  // Native projects will use the PostScript name
  }),

  /**
   * Font specifically for bold text in Phudu
   * Variable fonts on mobile might need explicit weight variants
   */
  phuduBold: Platform.select({
    web: 'Phudu',  // Web just uses the same name with weight in CSS
    default: 'Phudu-Variable-Bold'  // On native, we specify the bold variant directly
  }),
};

/**
 * Font styles that can be reused across the app
 */
export const fontStyles: Record<string, TextStyle> = {
  titleLarge: {
    fontFamily: Platform.select({
      web: fontFamilies.phudu,
      default: fontFamilies.phuduBold
    }),
    fontSize: 34,
    fontWeight: 'bold' as TextStyle['fontWeight'],
  },
  titleMedium: {
    fontFamily: Platform.select({
      web: fontFamilies.phudu,
      default: fontFamilies.phuduBold
    }),
    fontSize: 24,
    fontWeight: 'bold' as TextStyle['fontWeight'],
  },
  titleSmall: {
    fontFamily: Platform.select({
      web: fontFamilies.phudu,
      default: fontFamilies.phuduBold
    }),
    fontSize: 20,
    fontWeight: 'bold' as TextStyle['fontWeight'],
    },
    buttonText: {
        fontFamily: fontFamilies.phudu,
        fontSize: 16,
        fontWeight: '600' as TextStyle['fontWeight'],
    },
};
