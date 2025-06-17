import React from 'react';
import { TouchableWithoutFeedback, View, StyleSheet } from 'react-native';

export interface BottomSheetBackdropProps {
  appearsOnIndex?: number;
  disappearsOnIndex?: number;
  opacity?: number;
  onPress?: () => void;
  style?: any;
}

export const BottomSheetBackdrop: React.FC<BottomSheetBackdropProps> = ({
  appearsOnIndex = 0,
  disappearsOnIndex = -1,
  opacity = 0.5,
  onPress,
  style,
}) => {
  return (
    <TouchableWithoutFeedback onPress={onPress}>
      <View
        style={[
          styles.backdrop,
          {
            backgroundColor: `rgba(0, 0, 0, ${opacity})`,
          },
          style,
        ]}
      />
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});

BottomSheetBackdrop.displayName = 'BottomSheetBackdrop';