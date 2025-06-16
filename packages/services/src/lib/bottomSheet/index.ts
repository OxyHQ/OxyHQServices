// Re-export bottom sheet components from the ui/components/bottomSheet
export { 
  BottomSheetModal, 
  BottomSheetBackdrop, 
  BottomSheetModalProvider, 
  BottomSheetView,
  type BottomSheetModalRef,
  type BottomSheetBackdropProps
} from '../../ui/components/bottomSheet';

// Add BottomSheetScrollView - fallback implementation
let BottomSheetScrollView: any;

try {
  const bottomSheet = require('@gorhom/bottom-sheet');
  BottomSheetScrollView = bottomSheet.BottomSheetScrollView;
} catch (e) {
  // Fallback to regular ScrollView when @gorhom/bottom-sheet is not available
  const { ScrollView } = require('react-native');
  BottomSheetScrollView = ScrollView;
}

export { BottomSheetScrollView };