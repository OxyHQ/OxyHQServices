import React from 'react';
import { View, ViewProps } from 'react-native';

export interface BottomSheetViewProps extends ViewProps {
  children?: React.ReactNode;
}

export const BottomSheetView: React.FC<BottomSheetViewProps> = ({
  children,
  style,
  ...props
}) => {
  return (
    <View style={[{ flex: 1 }, style]} {...props}>
      {children}
    </View>
  );
};

BottomSheetView.displayName = 'BottomSheetView';