import React from 'react';
import { Switch, SwitchProps, Platform } from 'react-native';

interface AppleSwitchProps extends Omit<SwitchProps, 'trackColor' | 'thumbColor' | 'ios_backgroundColor'> {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export function AppleSwitch({ value, onValueChange, disabled, ...props }: AppleSwitchProps) {
  // Apple-style flat design colors
  // iOS: Green (#34C759) when on, dark gray (#3A3A3C) when off
  // Android: Green (#34C759) when on, light gray (#E5E5EA) when off
  const trackColor = {
    false: Platform.OS === 'ios' ? '#3A3A3C' : '#E5E5EA',
    true: '#34C759', // Apple green for both platforms
  };

  const thumbColor = '#FFFFFF'; // White thumb for both platforms

  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={trackColor}
      thumbColor={thumbColor}
      ios_backgroundColor={trackColor.false}
      style={props.style}
    />
  );
}

