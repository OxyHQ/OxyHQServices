import React, { useRef, useState } from 'react';
import { View, Text, Button, StyleSheet, ScrollView as RNScrollView } from 'react-native';
// Assuming BottomSheetModal is exported from here or a similar path
import { BottomSheetModal, BottomSheetModalRef } from '../src/ui/components/bottomSheet/BottomSheetModal';

const LIPSUM_SHORT = "Lorem ipsum dolor sit amet.";
const LIPSUM_MEDIUM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";
const LIPSUM_LONG = Array(15).fill(LIPSUM_MEDIUM).join('\n\n');

interface ContentComponentProps {
  text: string;
  height?: number | string;
}

const ContentComponent: React.FC<ContentComponentProps> = ({ text, height }) => (
  <View style={{ padding: 20, height }}>
    <Text style={{ marginBottom: 10, fontWeight: 'bold' }}>Sheet Content</Text>
    <RNScrollView nestedScrollEnabled>
      <Text>{text}</Text>
      <Button title="Button inside sheet" onPress={() => console.log('Button inside sheet pressed')} />
      {Array(10).fill(0).map((_, i) => <Text key={i} style={{paddingVertical: 5}}>Scrollable Item {i+1}</Text>)}
    </RNScrollView>
  </View>
);

const ShortContent = () => <ContentComponent text={LIPSUM_SHORT} />;
const MediumContent = () => <ContentComponent text={LIPSUM_MEDIUM} />;
const TallContent = () => <ContentComponent text={LIPSUM_LONG} />; // Height will be determined by scrollview

const BottomSheetTestScreen: React.FC = () => {
  const sheet1Ref = useRef<BottomSheetModalRef>(null);
  const sheet2Ref = useRef<BottomSheetModalRef>(null);
  const sheet3Ref = useRef<BottomSheetModalRef>(null);
  const sheet4Ref = useRef<BottomSheetModalRef>(null);
  const sheet5Ref = useRef<BottomSheetModalRef>(null);
  const sheet6Ref = useRef<BottomSheetModalRef>(null);
  const sheet7Ref = useRef<BottomSheetModalRef>(null);
  const sheet8Ref = useRef<BottomSheetModalRef>(null);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>BottomSheetModal Configurations Test</Text>

      <View style={styles.buttonGrid}>
        <Button title="Percentage Snaps" onPress={() => sheet1Ref.current?.present()} />
        <Button title="Fixed Snaps" onPress={() => sheet2Ref.current?.present()} />
        <Button title="Mixed Snaps" onPress={() => sheet3Ref.current?.present()} />
        <Button title="Short Content" onPress={() => sheet4Ref.current?.present()} />
        <Button title="Tall Content" onPress={() => sheet5Ref.current?.present()} />
        <Button title="Pan Close Enabled" onPress={() => sheet6Ref.current?.present()} />
        <Button title="Event Callbacks" onPress={() => sheet7Ref.current?.present()} />
        <Button title="Initial Index 1" onPress={() => sheet8Ref.current?.present()} />
      </View>

      <Text style={styles.instructions}>
        {`Instructions:
1. Press a button to show a BottomSheetModal with a specific configuration.
2. Interact with the sheet (drag, tap backdrop, scroll content).
3. Observe behavior for:
    - Correct snap point heights.
    - Content scrolling and visibility.
    - Gesture interactions (snapping, closing).
    - Animation smoothness.
4. Dismiss the sheet by panning down (if enabled), tapping backdrop, or a dismiss button if provided inside.
Note: This example is for manual/visual verification.`}
      </Text>

      {/* Test Case 1: Percentage Snap Points */}
      <BottomSheetModal ref={sheet1Ref} snapPoints={["25%", "50%", "80%"]} index={0}>
        <ContentComponent text="Using percentage snap points: 25%, 50%, 80%" />
      </BottomSheetModal>

      {/* Test Case 2: Fixed Value Snap Points */}
      <BottomSheetModal ref={sheet2Ref} snapPoints={[200, 400, 600]} index={0}>
        <ContentComponent text="Using fixed snap points: 200, 400, 600" />
      </BottomSheetModal>

      {/* Test Case 3: Mixed Snap Points */}
      <BottomSheetModal ref={sheet3Ref} snapPoints={["30%", 500, "90%"]} index={0}>
        <ContentComponent text="Using mixed snap points: 30%, 500, 90%" />
      </BottomSheetModal>

      {/* Test Case 4: Short Content */}
      <BottomSheetModal ref={sheet4Ref} snapPoints={["40%", "70%"]} index={0}>
        <ShortContent />
      </BottomSheetModal>

      {/* Test Case 5: Tall Content (should scroll) */}
      <BottomSheetModal ref={sheet5Ref} snapPoints={["50%", "85%"]} index={0}>
        <TallContent />
      </BottomSheetModal>

      {/* Test Case 6: Pan Down to Close enabled (default) vs disabled */}
      {/* For this, we might need two buttons or a toggle, or just trust default */}
      <BottomSheetModal
        ref={sheet6Ref}
        snapPoints={["50%"]}
        enablePanDownToClose={true} // Explicitly true (default)
      >
        <ContentComponent text="Pan down to close is enabled. Drag down to test." />
      </BottomSheetModal>

      {/* Test Case 7: Event Callbacks */}
      <BottomSheetModal
        ref={sheet7Ref}
        snapPoints={["30%", "60%"]}
        onChange={(idx) => console.log('[BottomSheetTestExample] onChange:', idx)}
        onAnimate={(from, to) => console.log(`[BottomSheetTestExample] onAnimate: from ${from} to ${to}`)}
      >
        <ContentComponent text="Test onChange and onAnimate. Check console output when snapping or closing." />
      </BottomSheetModal>

      {/* Test Case 8: Initial Index set to 1 */}
      <BottomSheetModal ref={sheet8Ref} snapPoints={["25%", "50%", "80%"]} index={1}>
        <ContentComponent text="Opens to 2nd snap point (index 1) initially." />
      </BottomSheetModal>

      {/*
        Further test cases to consider adding:
        - Sheet with no handle (handleComponent={() => null})
        - Sheet with custom handle
        - Sheet with backdrop disabled (backdropComponent={() => null})
        - Testing onChange and onAnimate callbacks (log to console)
        - Content that dynamically changes height
        - Snap points that are very close together or far apart
        - Behavior on different screen sizes (requires running on multiple devices/simulators)
      */}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingVertical: 50, // Added padding for better visibility on device
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 20,
  },
  instructions: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    paddingHorizontal: 15,
    marginBottom: 10,
  },
  // Button style can be added if needed, for now using default
});

// The original TestApp structure using OxyContext is removed as we need to test BottomSheetModal directly.
// If global context testing is still needed, it should be in a separate file or component.
export default BottomSheetTestScreen;
// Make sure BottomSheetModal and BottomSheetModalRef are correctly exported from their source file.
// e.g. in ../src/ui/components/bottomSheet/BottomSheetModal.tsx:
// export { BottomSheetModal, BottomSheetModalRef }; (if not already)
// or adjust import path accordingly.
