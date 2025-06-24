declare module 'react' {
  namespace JSX {
    interface ElementClass {
      render(): any;
    }
  }
}

// Fix for React Native SVG components
declare module 'react-native-svg' {
  export interface SvgProps {
    [key: string]: any;
  }
  
  export interface PathProps {
    [key: string]: any;
  }
  
  export interface CircleProps {
    [key: string]: any;
  }
  
  export interface LinearGradientProps {
    [key: string]: any;
  }
  
  export interface StopProps {
    [key: string]: any;
  }
}

// Fix for Expo Vector Icons
declare module '@expo/vector-icons' {
  export interface IconProps<T = any> {
    [key: string]: any;
  }
} 