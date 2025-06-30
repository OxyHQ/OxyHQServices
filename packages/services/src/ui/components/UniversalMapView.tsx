import { Platform } from 'react-native';

// eslint-disable-next-line import/extensions, import/no-unresolved
import NativeComponent from './UniversalMapView.native';
// eslint-disable-next-line import/extensions, import/no-unresolved
import WebComponent from './UniversalMapView.web';

// Use "any" to avoid cross-platform type inference issues
const UniversalMapView: any = Platform.OS === 'web' ? WebComponent : NativeComponent;

export default UniversalMapView; 