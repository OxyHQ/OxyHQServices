import React from 'react';
import { ScrollView, ScrollViewProps } from 'react-native';

export interface BottomSheetScrollViewProps extends ScrollViewProps {
  children?: React.ReactNode;
}

export const BottomSheetScrollView: React.FC<BottomSheetScrollViewProps> = ({
  children,
  style,
  ...props
}) => {
  return (
    <ScrollView
      style={[{ flex: 1 }, style]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      {...props}
    >
      {children}
    </ScrollView>
  );
};

BottomSheetScrollView.displayName = 'BottomSheetScrollView';