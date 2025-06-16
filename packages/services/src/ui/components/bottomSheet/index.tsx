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
  
  BottomSheetModal = React.forwardRef(({ children, snapPoints, ...props }: any, ref: any) => {
    const [visible, setVisible] = React.useState(false);
    
    // Implement ref methods for the fallback modal
    React.useImperativeHandle(ref, () => ({
      present: () => setVisible(true),
      dismiss: () => setVisible(false),
      close: () => setVisible(false),
      snapToIndex: () => {}, // Not applicable for modal
      expand: () => setVisible(true),
      collapse: () => setVisible(false),
    }));

    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
        {...props}
      >
        <View style={styles.fallbackModal}>
          <TouchableOpacity 
            style={styles.fallbackBackdrop} 
            onPress={() => setVisible(false)}
            activeOpacity={1}
          />
          <View style={styles.fallbackBottomSheet}>
            {children}
          </View>
        </View>
      </Modal>
    );
  });
  
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
    backgroundColor: 'transparent',
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
    borderTopLeftRadius: 35,
    borderTopRightRadius: 35,
    padding: 20,
    minHeight: 200,
    maxHeight: '85%',
  },
});

export {
    BottomSheetModal,
    BottomSheetBackdrop,
    BottomSheetModalProvider,
    BottomSheetView
};
