import React from 'react';
import { Image, StyleSheet, ImageStyle } from 'react-native';

interface LogoProps {
  height?: number;
  style?: ImageStyle;
}

/**
 * Oxy Logo component
 * Maintains the correct aspect ratio based on the SVG viewBox (294.84/174.42 ≈ 1.69)
 */
export function Logo({ height = 32, style }: LogoProps) {
  // Calculate width based on aspect ratio from SVG viewBox
  // viewBox: "0 0 294.84 174.42" -> aspect ratio ≈ 1.69
  const width = height * (294.84 / 174.42);

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

