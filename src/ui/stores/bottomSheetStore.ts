import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Animated } from 'react-native';

export interface BottomSheetState {
  // UI state
  contentHeight: number;
  snapPoints: (string | number)[];
  keyboardVisible: boolean;
  keyboardHeight: number;
  isPresented: boolean;
  currentScreen: string;
  screenProps?: Record<string, any>;

  // Animation values - stored as objects to avoid Zustand reactivity issues
  fadeAnimValue: number;
  slideAnimValue: number;
  handleScaleAnimValue: number;

  // Actions
  setContentHeight: (height: number) => void;
  setSnapPoints: (points: (string | number)[]) => void;
  setKeyboardVisible: (visible: boolean) => void;
  setKeyboardHeight: (height: number) => void;
  setPresented: (presented: boolean) => void;
  setCurrentScreen: (screen: string, props?: Record<string, any>) => void;
  setFadeAnimValue: (value: number) => void;
  setSlideAnimValue: (value: number) => void;
  setHandleScaleAnimValue: (value: number) => void;
  
  // Computed helpers
  isExpanded: () => boolean;
  resetAnimations: () => void;
  updateSnapPointsForKeyboard: (screenHeight: number) => void;
  updateSnapPointsForContent: (screenHeight: number) => void;
}

export const useBottomSheetStore = create<BottomSheetState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    contentHeight: 0,
    snapPoints: ['60%', '85%'],
    keyboardVisible: false,
    keyboardHeight: 0,
    isPresented: false,
    currentScreen: 'SignIn',
    screenProps: undefined,
    
    // Animation values
    fadeAnimValue: 0,
    slideAnimValue: 50,
    handleScaleAnimValue: 1,

    // Actions
    setContentHeight: (contentHeight) => set({ contentHeight }),
    setSnapPoints: (snapPoints) => set({ snapPoints }),
    setKeyboardVisible: (keyboardVisible) => set({ keyboardVisible }),
    setKeyboardHeight: (keyboardHeight) => set({ keyboardHeight }),
    setPresented: (isPresented) => set({ isPresented }),
    setCurrentScreen: (currentScreen, screenProps) => set({ currentScreen, screenProps }),
    setFadeAnimValue: (fadeAnimValue) => set({ fadeAnimValue }),
    setSlideAnimValue: (slideAnimValue) => set({ slideAnimValue }),
    setHandleScaleAnimValue: (handleScaleAnimValue) => set({ handleScaleAnimValue }),

    // Computed helpers
    isExpanded: () => {
      const { snapPoints } = get();
      return snapPoints[0] === snapPoints[1]; // Both snap points are the same when expanded
    },

    resetAnimations: () => set({
      fadeAnimValue: 0,
      slideAnimValue: 50,
      handleScaleAnimValue: 1
    }),

    updateSnapPointsForKeyboard: (screenHeight) => {
      const { keyboardVisible, snapPoints } = get();
      
      if (keyboardVisible) {
        // When keyboard is visible, use the highest snap point for both
        const highestPoint = snapPoints[snapPoints.length - 1];
        set({ snapPoints: [highestPoint, highestPoint] });
      }
    },

    updateSnapPointsForContent: (screenHeight) => {
      const { contentHeight, keyboardVisible, snapPoints: currentSnapPoints } = get();
      
      if (!keyboardVisible && contentHeight > 0) {
        const contentHeightPercent = Math.min(
          Math.ceil((contentHeight + 40) / screenHeight * 100), 
          90
        ) + '%';
        
        const firstPoint = contentHeight / screenHeight > 0.6 
          ? contentHeightPercent 
          : currentSnapPoints[0];
          
        set({ snapPoints: [firstPoint, currentSnapPoints[1]] });
      }
    },
  }))
);