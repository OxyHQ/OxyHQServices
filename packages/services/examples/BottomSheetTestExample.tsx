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

const DynamicContentComponent: React.FC = () => {
  const [text, setText] = useState(LIPSUM_SHORT);
  const [extraContentVisible, setExtraContentVisible] = useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setText(LIPSUM_MEDIUM + (extraContentVisible ? "" : "\n\nMore dynamic content loaded!"));
      setExtraContentVisible(!extraContentVisible); // Toggle for subsequent presses if sheet is re-opened
    }, 2000); // Simulate loading delay
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount, or re-run if key changes for the component instance

  return (
    <View style={{ padding: 20 }}>
      <Text style={{ marginBottom: 10, fontWeight: 'bold' }}>Dynamic Content</Text>
      <Text>{text}</Text>
      {extraContentVisible && <View style={{marginTop: 10, padding:10, backgroundColor: '#e0e0e0'}}><Text>This is extra content that appeared.</Text></View>}
      <Button title="Toggle More Content Manually" onPress={() => {
         setText(LIPSUM_MEDIUM + (!extraContentVisible ? "\n\nManually added more dynamic content!" : ""));
         setExtraContentVisible(!extraContentVisible);
      }}/>
    </View>
  );
};

const BottomSheetTestScreen: React.FC = () => {
  const sheet1Ref = useRef<BottomSheetModalRef>(null);
  const sheet2Ref = useRef<BottomSheetModalRef>(null);
  const sheet3Ref = useRef<BottomSheetModalRef>(null);
  const sheet4Ref = useRef<BottomSheetModalRef>(null);
  const sheet5Ref = useRef<BottomSheetModalRef>(null);
  const sheet6Ref = useRef<BottomSheetModalRef>(null);
  const sheet7Ref = useRef<BottomSheetModalRef>(null);
  const sheet8Ref = useRef<BottomSheetModalRef>(null);
  const sheet9Ref = useRef<BottomSheetModalRef>(null); // For adjustToContentHeightUpToSnapPoint={true}
  const sheet10Ref = useRef<BottomSheetModalRef>(null); // For adjustToContentHeightUpToSnapPoint={false}
  const sheet11Ref = useRef<BottomSheetModalRef>(null); // For screen orientation change test

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
        <Button title="Dynamic Content (Adjust True)" onPress={() => sheet9Ref.current?.present()} />
        <Button title="Dynamic Content (Adjust False)" onPress={() => sheet10Ref.current?.present()} />
        <Button title="Orientation Change Test" onPress={() => sheet11Ref.current?.present()} />
      </View>

      <Text style={styles.instructions}>
        {`Instructions:
1. Press a button to show a BottomSheetModal.
2. Interact with the sheet (drag, scroll, etc.).
3. Observe behavior for:
    - Correct snap point heights & content fit.
    - Scrolling, gesture interactions, animations.
    - For "Dynamic Content (Adjust True)": sheet should resize after ~2s.
    - For "Orientation Change Test": open sheet, rotate device/simulator, observe sheet adapts to new screen height and percentages. Drag and snap.
4. Dismiss the sheet.
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

      {/* Test Case 9: Dynamic Content with adjustToContentHeightUpToSnapPoint = true */}
      <BottomSheetModal
        ref={sheet9Ref}
        snapPoints={["50%", "80%"]} // Snap points act as max heights
        adjustToContentHeightUpToSnapPoint={true}
        index={0}
      >
        <DynamicContentComponent key="dynamicTrue" />
      </BottomSheetModal>

      {/* Test Case 10: Dynamic Content with adjustToContentHeightUpToSnapPoint = false (default) */}
      <BottomSheetModal
        ref={sheet10Ref}
        snapPoints={["50%", "80%"]}
        adjustToContentHeightUpToSnapPoint={false}
        index={0}
      >
        <DynamicContentComponent key="dynamicFalse" />
      </BottomSheetModal>

      {/* Test Case 11: Screen Orientation Change Test */}
      <BottomSheetModal
        ref={sheet11Ref}
        snapPoints={["30%", "60%", "90%"]} // Percentages are good for this test
        index={1}
      >
        <ContentComponent text="Rotate the screen. Sheet should adapt to new height based on percentage snap points. Test dragging and snapping after rotation." />
      </BottomSheetModal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingVertical: 30, // Adjusted padding
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15, // Adjusted margin
    textAlign: 'center',
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 15, // Adjusted margin
  },
  instructions: {
    fontSize: 14,
    color: '#555',
    textAlign: 'left', // Align left for better readability of multi-line
    paddingHorizontal: 15,
    marginBottom: 10,
    lineHeight: 20, // Added for spacing
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
