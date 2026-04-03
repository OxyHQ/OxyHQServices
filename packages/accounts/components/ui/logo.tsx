import React from 'react';
import { Image, StyleSheet, ImageStyle } from 'react-native';

interface LogoProps {
  height?: number;
  style?: ImageStyle;
}

/**
 * Oxy Logo component
 * Maintains the correct aspect ratio based on the SVG viewBox (41/22 ≈ 1.86)
 */
export function Logo({ height = 32, style }: LogoProps) {
  // Calculate width based on aspect ratio from SVG viewBox
  // viewBox: "0 0 41 22" -> aspect ratio ≈ 1.86
  const width = height * (41 / 22);

  return (
    <Image 
      source={require('@/assets/images/OxyLogo.svg')} 
      style={[styles.logo, { height, width }, style]}
      contentFit="contain"
    />
  );
}

const styles = StyleSheet.create({
  logo: {
    // Width and height are set dynamically via props
  },
});

