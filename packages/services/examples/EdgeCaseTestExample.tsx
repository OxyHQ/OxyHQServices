/**
 * Edge Case Test Application for Bottom Sheet
 * 
 * This tests various edge cases and challenging configurations
 * to ensure the bottom sheet behaves correctly.
 */

import React, { useRef } from 'react';
import { View, Text, Button, StyleSheet, ScrollView } from 'react-native';
import { 
  BottomSheetModal, 
  BottomSheetModalProvider,
  BottomSheetScrollView 
} from '../src/ui/components/bottomSheet';
import type { BottomSheetModalRef } from '../src/ui/components/bottomSheet';

const EdgeCaseTestExample: React.FC = () => {
  const edgeCaseRef1 = useRef<BottomSheetModalRef>(null);
  const edgeCaseRef2 = useRef<BottomSheetModalRef>(null);
  const edgeCaseRef3 = useRef<BottomSheetModalRef>(null);
  const edgeCaseRef4 = useRef<BottomSheetModalRef>(null);

  const testCases = [
    {
      title: 'Edge Case 1: Over 100% Snap Points',
      snapPoints: ['120%', '150%', '200%'],
      ref: edgeCaseRef1,
      description: 'Tests snap points that exceed screen height'
    },
    {
      title: 'Edge Case 2: Very Large Fixed Heights',
      snapPoints: [2000, 3000, 5000],
      ref: edgeCaseRef2,
      description: 'Tests fixed heights much larger than screen'
    },
    {
      title: 'Edge Case 3: Invalid/Negative Values',
      snapPoints: ['-50%', '0%', -100],
      ref: edgeCaseRef3,
      description: 'Tests negative and zero values'
    },
    {
      title: 'Edge Case 4: Mixed Valid/Invalid',
      snapPoints: ['25%', 5000, '150%', 300],
      ref: edgeCaseRef4,
      description: 'Tests mix of valid and problematic values'
    }
  ];

  const openSheet = (ref: React.RefObject<BottomSheetModalRef>) => {
    ref.current?.present();
  };

  const renderContent = (testCase: any) => (
    <BottomSheetScrollView contentContainerStyle={styles.contentContainer}>
      <Text style={styles.contentTitle}>{testCase.title}</Text>
      <Text style={styles.description}>{testCase.description}</Text>
      <Text style={styles.snapPointsText}>
        Snap Points: {JSON.stringify(testCase.snapPoints)}
      </Text>
      
      <View style={styles.testSection}>
        <Text style={styles.sectionTitle}>Expected Behavior:</Text>
        <Text style={styles.testText}>• Should not extend beyond screen bounds</Text>
        <Text style={styles.testText}>• Should be draggable without glitches</Text>
        <Text style={styles.testText}>• Should animate smoothly between positions</Text>
        <Text style={styles.testText}>• Should handle invalid values gracefully</Text>
      </View>

      <View style={styles.testSection}>
        <Text style={styles.sectionTitle}>Test Instructions:</Text>
        <Text style={styles.testText}>1. Try dragging the sheet up and down</Text>
        <Text style={styles.testText}>2. Test different snap positions</Text>
        <Text style={styles.testText}>3. Verify no visual glitches or overflow</Text>
        <Text style={styles.testText}>4. Check that sheet stays within screen bounds</Text>
      </View>

      {/* Add some content to test scrolling */}
      <View style={styles.scrollTestSection}>
        <Text style={styles.sectionTitle}>Scroll Test Content:</Text>
        {Array.from({ length: 20 }, (_, i) => (
          <Text key={i} style={styles.scrollItem}>
            Content item {i + 1} - This content should scroll properly without overflow
          </Text>
        ))}
      </View>
    </BottomSheetScrollView>
  );

  return (
    <BottomSheetModalProvider>
      <ScrollView style={styles.container} contentContainerStyle={styles.containerContent}>
        <Text style={styles.title}>Bottom Sheet Edge Case Tests</Text>
        <Text style={styles.subtitle}>
          These tests verify that the bottom sheet handles problematic configurations correctly
        </Text>

        <View style={styles.testGrid}>
          {testCases.map((testCase, index) => (
            <View key={index} style={styles.testCard}>
              <Text style={styles.testCardTitle}>{testCase.title}</Text>
              <Text style={styles.testCardDescription}>{testCase.description}</Text>
              <Text style={styles.testCardSnapPoints}>
                {JSON.stringify(testCase.snapPoints)}
              </Text>
              <Button 
                title="Test This Case" 
                onPress={() => openSheet(testCase.ref)}
              />
            </View>
          ))}
        </View>

        {/* Render all the bottom sheet modals */}
        {testCases.map((testCase, index) => (
          <BottomSheetModal
            key={index}
            ref={testCase.ref}
            index={0}
            snapPoints={testCase.snapPoints}
            enableInternalToaster={true}
          >
            {renderContent(testCase)}
          </BottomSheetModal>
        ))}
      </ScrollView>
    </BottomSheetModalProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  containerContent: {
    padding: 20,
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
  testGrid: {
    gap: 16,
  },
  testCard: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  testCardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  testCardDescription: {
    fontSize: 14,
    marginBottom: 8,
    color: '#666',
    lineHeight: 20,
  },
  testCardSnapPoints: {
    fontSize: 12,
    marginBottom: 12,
    color: '#888',
    fontFamily: 'monospace',
    backgroundColor: '#f8f8f8',
    padding: 8,
    borderRadius: 4,
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
  description: {
    fontSize: 16,
    marginBottom: 16,
    color: '#666',
    lineHeight: 22,
    textAlign: 'center',
  },
  snapPointsText: {
    fontSize: 14,
    marginBottom: 24,
    color: '#888',
    fontFamily: 'monospace',
    backgroundColor: '#f8f8f8',
    padding: 12,
    borderRadius: 8,
    textAlign: 'center',
  },
  testSection: {
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#f0f8ff',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#007bff',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  testText: {
    fontSize: 14,
    marginBottom: 6,
    color: '#555',
    lineHeight: 20,
  },
  scrollTestSection: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#fff8e7',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#ffa500',
  },
  scrollItem: {
    fontSize: 14,
    marginBottom: 8,
    color: '#666',
    padding: 8,
    backgroundColor: 'white',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#eee',
  },
});

export default EdgeCaseTestExample;