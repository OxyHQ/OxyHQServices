// React Native SVG component fixes
declare module 'react-native-svg' {
  import { Component } from 'react';
  
  export default class Svg extends Component<any, any> {}
  export class Circle extends Component<any, any> {}
  export class Path extends Component<any, any> {}
  export class Defs extends Component<any, any> {}
  export class LinearGradient extends Component<any, any> {}
  export class Stop extends Component<any, any> {}
}

// Expo Vector Icons fixes  
declare module '@expo/vector-icons' {
  import { Component } from 'react';
  
  export class Ionicons extends Component<any, any> {}
  export class MaterialIcons extends Component<any, any> {}
  export class FontAwesome extends Component<any, any> {}
}

// React Native Reanimated fixes
declare module 'react-native-reanimated' {
  export function useSharedValue(initialValue: any): any;
  export function useAnimatedStyle(callback: () => any): any;
  export function withSpring(value: any, config?: any, callback?: () => void): any;
  export function interpolateColor(value: any, inputRange: any[], outputRange: any[]): any;
  export function withTiming(value: any, config?: any): any;
  export function runOnJS(callback: (...args: any[]) => any): (...args: any[]) => any;
  export const Easing: any;
  
  export const Animated: {
    View: any;
    Text: any;
    ScrollView: any;
  };
}

// BottomSheet component fixes
declare module '@gorhom/bottom-sheet' {
  import { Component } from 'react';
  
  export class BottomSheetBackdrop extends Component<any, any> {}
  export class BottomSheetScrollView extends Component<any, any> {}
  export class BottomSheetModal extends Component<any, any> {}
  export class BottomSheetModalProvider extends Component<any, any> {}
  export class BottomSheetView extends Component<any, any> {}
  
  export interface BottomSheetModalProps {
    [key: string]: any;
  }
  
  export interface BottomSheetBackdropProps {
    [key: string]: any;
  }
  
  export default class BottomSheet extends Component<any, any> {}
} 