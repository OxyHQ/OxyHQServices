// React Native SVG component fixes
declare module 'react-native-svg' {
  import { Component } from 'react';
  
  export default class Svg extends Component<any, any> {}
  export class Circle extends Component<any, any> {}
  export class Path extends Component<any, any> {}
  export class LinearGradient extends Component<any, any> {}
  export class Stop extends Component<any, any> {}
}

// Expo Vector Icons fixes  
declare module '@expo/vector-icons' {
  import { Component } from 'react';
  
  export namespace Ionicons {
    class Icon extends Component<any, any> {}
  }
} 