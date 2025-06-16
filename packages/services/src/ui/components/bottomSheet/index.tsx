import React from 'react';
import { View, Modal, TouchableOpacity, StyleSheet } from 'react-native';

// Define types for compatibility
export interface BottomSheetModalRef {
  present: () => void;
  dismiss: () => void;
  close: () => void;
  snapToIndex: (index: number) => void;
}

export interface BottomSheetBackdropProps {
  style?: any;
  disappearsOnIndex?: number;
  appearsOnIndex?: number;
  opacity?: number;
  pressBehavior?: 'none' | 'close' | 'collapse';
}

// Define fallback components when @gorhq/bottom-sheet is not available
let BottomSheetModal: any;
let BottomSheetBackdrop: any;
let BottomSheetModalProvider: any;
let BottomSheetView: any;

try {
  const bottomSheet = require('@gorhom/bottom-sheet');
  BottomSheetModal = bottomSheet.BottomSheetModal;
  BottomSheetBackdrop = bottomSheet.BottomSheetBackdrop;
  BottomSheetModalProvider = bottomSheet.BottomSheetModalProvider;
  BottomSheetView = bottomSheet.BottomSheetView;
} catch (e) {
  // Fallback components
  BottomSheetModalProvider = ({ children }: any) => <>{children}</>;
  
  BottomSheetModal = React.forwardRef(({ children, snapPoints, ...props }: any, ref: any) => (
    <Modal
      visible={false}
      transparent
      animationType="slide"
      {...props}
    >
      <View style={styles.fallbackModal}>
        {children}
      </View>
    </Modal>
  ));
  
  BottomSheetBackdrop = ({ style, ...props }: BottomSheetBackdropProps) => (
    <TouchableOpacity 
      style={[styles.fallbackBackdrop, style]} 
      {...props} 
    />
  );
  
  BottomSheetView = ({ children, style, ...props }: any) => (
    <View style={[styles.fallbackBottomSheet, style]} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fallbackModal: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  fallbackBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  fallbackBottomSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    minHeight: 200,
  },
});

export {
    BottomSheetModal,
    BottomSheetBackdrop,
    BottomSheetModalProvider,
    BottomSheetView
};
