/**
 * Lightweight stub for `react-native-keyboard-controller` in the commons Jest env.
 */
import { createElement, type ReactNode } from 'react';

export const KeyboardAwareScrollView = ({ children }: { children?: ReactNode }) =>
  createElement('div', null, children);

export const KeyboardProvider = ({ children }: { children?: ReactNode }) =>
  createElement('div', null, children);
