// Re-export bottom sheet components
export { BottomSheetView } from '../ui/components/bottomSheet';

// Import BottomSheetScrollView from the actual bottom sheet library
let BottomSheetScrollView: any;

try {
  const bottomSheet = require('@gorhom/bottom-sheet');
  BottomSheetScrollView = bottomSheet.BottomSheetScrollView;
} catch (e) {
  // Fallback to regular ScrollView
  const { ScrollView } = require('react-native');
  BottomSheetScrollView = ScrollView;
}

export { BottomSheetScrollView };