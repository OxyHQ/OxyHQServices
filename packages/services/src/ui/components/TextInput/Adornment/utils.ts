import type { InternalTheme } from "../types";

type BaseProps = {
  theme: InternalTheme;
  disabled?: boolean;
};

// Simple hex to rgba conversion
const hexToRgba = (hex: string, alpha: number): string => {
  // Handle rgba strings
  if (hex.startsWith('rgba')) {
    return hex;
  }
  // Handle rgb strings
  if (hex.startsWith('rgb')) {
    const match = hex.match(/\d+/g);
    if (match && match.length >= 3) {
      return `rgba(${match[0]}, ${match[1]}, ${match[2]}, ${alpha})`;
    }
  }
  // Handle hex strings
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export function getTextColor({ theme, disabled }: BaseProps) {
  if (theme.isV3) {
    if (disabled) {
      return theme.colors.onSurfaceDisabled;
    }
    return theme.colors.onSurfaceVariant;
  }
  // For non-V3 themes, apply opacity to text color
  const textColor = theme?.colors?.onSurface || theme?.colors?.text || '#000000';
  const opacity = theme.dark ? 0.7 : 0.54;
  return hexToRgba(textColor, opacity);
}

export function getIconColor({
  theme,
  isTextInputFocused,
  disabled,
  customColor,
}: BaseProps & {
  isTextInputFocused: boolean;
  customColor?: ((isTextInputFocused: boolean) => string | undefined) | string;
}) {
  if (typeof customColor === 'function') {
    return customColor(isTextInputFocused);
  }
  if (customColor) {
    return customColor;
  }

  if (!theme.isV3) {
    return theme.colors.text;
  }

  if (disabled) {
    return theme.colors.onSurfaceDisabled;
  }

  return theme.colors.onSurfaceVariant;
}
