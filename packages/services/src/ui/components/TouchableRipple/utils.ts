import type { ColorValue } from 'react-native';

import color from 'color';

import type { InternalTheme } from '../types';

const getUnderlayColor = ({
  theme,
  calculatedRippleColor,
  underlayColor,
}: {
  theme: InternalTheme;
  calculatedRippleColor: ColorValue;
  underlayColor?: string;
}) => {
  if (underlayColor != null) {
    return underlayColor;
  }

  if (theme.isV3) {
    return typeof calculatedRippleColor === 'string' ? calculatedRippleColor : '#000000';
  }

  return colorUtil(typeof calculatedRippleColor === 'string' ? calculatedRippleColor : '#000000').fade(0.5).rgb().string();
};

const getRippleColor = ({
  theme,
  rippleColor,
}: {
  theme: InternalTheme;
  rippleColor?: ColorValue;
}) => {
  if (rippleColor) {
    return rippleColor;
  }

  if (theme.isV3) {
    return colorUtil(theme.colors.onSurface).alpha(0.12).rgb().string();
  }

  if (theme.dark) {
    return colorUtil(theme.colors.onSurface || theme.colors.text).alpha(0.32).rgb().string();
  }
  return colorUtil(theme.colors.text).alpha(0.2).rgb().string();
};

export const getTouchableRippleColors = ({
  theme,
  rippleColor,
  underlayColor,
}: {
  theme: InternalTheme;
  rippleColor?: ColorValue;
  underlayColor?: string;
}) => {
  const calculatedRippleColor = getRippleColor({ theme, rippleColor });
  return {
    calculatedRippleColor,
    calculatedUnderlayColor: getUnderlayColor({
      theme,
      calculatedRippleColor,
      underlayColor,
    }),
  };
};
