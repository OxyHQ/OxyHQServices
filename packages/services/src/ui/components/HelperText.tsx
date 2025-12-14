import * as React from 'react';
import {
  Animated,
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  TextStyle,
} from 'react-native';
import { useThemeColors } from '../styles';

// Helper function for text color
const getTextColor = (colors: ReturnType<typeof useThemeColors>, disabled?: boolean, type?: 'error' | 'info') => {
  if (type === 'error') {
    return colors.error;
  }
  if (disabled) {
    return colors.secondaryText + '80'; // Add opacity
  }
  return colors.secondaryText;
};

export type HelperTextProps = {
  /**
   * Type of the helper text.
   */
  type?: 'error' | 'info';
  /**
   * Text content of the HelperText.
   */
  children: React.ReactNode;
  /**
   * Whether to display the helper text.
   */
  visible?: boolean;
  /**
   * Whether to apply padding to the helper text.
   */
  padding?: 'none' | 'normal';
  /**
   * Whether the text input tied with helper text is disabled.
   */
  disabled?: boolean;
  style?: StyleProp<TextStyle>;
  /**
   * Theme to use ('light' | 'dark')
   */
  theme?: 'light' | 'dark';
  /**
   * TestID used for testing purposes
   */
  testID?: string;
  /**
   * Callback when layout changes
   */
  onLayout?: (event: LayoutChangeEvent) => void;
  /**
   * Maximum font size multiplier
   */
  maxFontSizeMultiplier?: number;
};

/**
 * Helper text is used in conjunction with input elements to provide additional hints for the user.
 */
const HelperText = ({
  style,
  type = 'info',
  visible = true,
  theme: themeProp = 'light',
  onLayout,
  padding = 'normal',
  disabled,
  maxFontSizeMultiplier = 1.5,
  ...rest
}: HelperTextProps) => {
  const colors = useThemeColors(themeProp);
  const { current: shown } = React.useRef<Animated.Value>(
    new Animated.Value(visible ? 1 : 0)
  );

  let { current: textHeight } = React.useRef<number>(0);

  React.useEffect(() => {
    if (visible) {
      // show text
      Animated.timing(shown, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
    } else {
      // hide text
      Animated.timing(shown, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, shown]);

  const handleTextLayout = (e: LayoutChangeEvent) => {
    onLayout?.(e);
    textHeight = e.nativeEvent.layout.height;
  };

  // Get text color based on type and disabled state
  const getTextColor = () => {
    if (type === 'error') {
      return colors.error;
    }
    if (disabled) {
      return colors.secondaryText + '80'; // Add opacity
    }
    return colors.secondaryText;
  };

  const textColor = getTextColor();

  return (
    <Animated.Text
      onLayout={handleTextLayout}
      style={[
        styles.text,
        padding !== 'none' ? styles.padding : {},
        {
          color: textColor,
          opacity: shown,
          transform:
            visible && type === 'error'
              ? [
                {
                  translateY: shown.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-textHeight / 2, 0],
                  }),
                },
              ]
              : [],
        },
        style,
      ]}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...rest}
    >
      {rest.children}
    </Animated.Text>
  );
};

const styles = StyleSheet.create({
  text: {
    fontSize: 12,
    paddingVertical: 4,
  },
  padding: {
    paddingHorizontal: 12,
  },
});

export default HelperText;
