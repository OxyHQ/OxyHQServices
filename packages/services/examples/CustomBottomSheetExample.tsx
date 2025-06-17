/**
 * Custom Bottom Sheet Example
 * 
 * This example demonstrates the custom bottom sheet implementation
 * that replaces @gorhom/bottom-sheet dependency
 */

import React, { useRef } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { 
  BottomSheetModal, 
  BottomSheetModalProvider,
  BottomSheetScrollView 
} from '../src/ui/components/bottomSheet';
import type { BottomSheetModalRef } from '../src/ui/components/bottomSheet';

const CustomBottomSheetExample: React.FC = () => {
  const bottomSheetRef = useRef<BottomSheetModalRef>(null);

  const handlePresentModalPress = () => {
    bottomSheetRef.current?.present();
  };

  const handleDismissModalPress = () => {
    bottomSheetRef.current?.dismiss();
  };

  const handleExpandPress = () => {
    bottomSheetRef.current?.expand();
  };

  const handleCollapsePress = () => {
    bottomSheetRef.current?.collapse();
  };

  return (
    <BottomSheetModalProvider>
      <View style={styles.container}>
        <Text style={styles.title}>Custom Bottom Sheet Example</Text>
        <Text style={styles.subtitle}>
          This demonstrates the custom bottom sheet implementation
          that replaces @gorhom/bottom-sheet
        </Text>

        <View style={styles.buttonContainer}>
          <Button title="Present Modal" onPress={handlePresentModalPress} />
          <Button title="Expand" onPress={handleExpandPress} />
          <Button title="Collapse" onPress={handleCollapsePress} />
          <Button title="Dismiss Modal" onPress={handleDismissModalPress} />
        </View>

        <BottomSheetModal
          ref={bottomSheetRef}
          index={0}
          snapPoints={['25%', '50%', '90%']}
          onChange={(index) => console.log('Sheet index changed to:', index)}
          onAnimate={(from, to) => console.log(`Animating from ${from} to ${to}`)}
        >
          <BottomSheetScrollView contentContainerStyle={styles.contentContainer}>
            <Text style={styles.contentTitle}>🎉 Custom Bottom Sheet</Text>
            <Text style={styles.contentText}>
              This is our custom implementation that provides:
            </Text>
            <Text style={styles.feature}>✅ Drag gestures</Text>
            <Text style={styles.feature}>✅ Snap points</Text>
            <Text style={styles.feature}>✅ Backdrop</Text>
            <Text style={styles.feature}>✅ Animations</Text>
            <Text style={styles.feature}>✅ Handle indicator</Text>
            <Text style={styles.feature}>✅ Keyboard handling</Text>
            <Text style={styles.feature}>✅ Cross-platform support</Text>
            
            <View style={styles.spacer} />
            
            <Text style={styles.contentText}>
              No external dependencies required! 🚀
            </Text>
            
            <View style={styles.spacer} />
            
            <Text style={styles.instructions}>
              Try dragging the sheet or using the buttons above to test the functionality.
            </Text>
          </BottomSheetScrollView>
        </BottomSheetModal>
      </View>
    </BottomSheetModalProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 12,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    color: '#666',
    lineHeight: 22,
  },
  buttonContainer: {
    gap: 12,
  },
  contentContainer: {
    padding: 24,
  },
  contentTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
    color: '#333',
  },
  contentText: {
    fontSize: 16,
    marginBottom: 16,
    color: '#666',
    lineHeight: 22,
  },
  feature: {
    fontSize: 14,
    marginBottom: 8,
    color: '#4CAF50',
    fontWeight: '500',
  },
  spacer: {
    height: 16,
  },
  instructions: {
    fontSize: 14,
    fontStyle: 'italic',
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default CustomBottomSheetExample;