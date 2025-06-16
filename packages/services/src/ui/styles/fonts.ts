import { Platform, TextStyle } from 'react-native';

/**
 * Font family names for use across the app
 * 
 * For web platforms, we use the CSS font name with weights
 * For native platforms, we use the specific static font file names
 */
export const fontFamilies = {
  // Regular weight (400)
  phudu: Platform.select({
    web: 'Phudu',  // Web projects will use standard CSS font name
    default: 'Phudu-Regular'  // Native projects use the specific weight font
  }),

  // Light weight (300)
  phuduLight: Platform.select({
    web: 'Phudu',  // Web uses CSS weight
    default: 'Phudu-Light'  // Native uses specific font
  }),

  // Medium weight (500)
  phuduMedium: Platform.select({
    web: 'Phudu',  // Web uses CSS weight
    default: 'Phudu-Medium'  // Native uses specific font
  }),

  // SemiBold weight (600)
  phuduSemiBold: Platform.select({
    web: 'Phudu',  // Web uses CSS weight
    default: 'Phudu-SemiBold'  // Native uses specific font
  }),

  // Bold weight (700)
  phuduBold: Platform.select({
    web: 'Phudu',  // Web uses CSS weight 
    default: 'Phudu-Bold'  // Native uses specific font
  }),

  // ExtraBold weight (800)
  phuduExtraBold: Platform.select({
    web: 'Phudu',  // Web uses CSS weight
    default: 'Phudu-ExtraBold'  // Native uses specific font
  }),

  // Black weight (900)
  phuduBlack: Platform.select({
    web: 'Phudu',  // Web uses CSS weight
    default: 'Phudu-Black'  // Native uses specific font
  }),
};

/**
 * Font styles that can be reused across the app
 */
export const fontStyles: Record<string, TextStyle> = {
  titleLarge: {
    fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
    fontSize: 54,
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
  },
  titleMedium: {
    fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
    fontSize: 24,
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
  },
  titleSmall: {
    fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
    fontSize: 20,
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
  },
  buttonText: {
    fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-SemiBold',
    fontSize: 16,
    fontWeight: Platform.OS === 'web' ? '600' : undefined,  // Only apply fontWeight on web
  },
};
