declare module 'expo-haptics' {
  export enum ImpactFeedbackStyle {
    Light = 'light',
    Medium = 'medium',
    Heavy = 'heavy',
    Rigid = 'rigid',
    Soft = 'soft',
  }

  export enum NotificationFeedbackType {
    Success = 'success',
    Warning = 'warning',
    Error = 'error',
  }

  export enum AndroidHaptics {
    Confirm = 'confirm',
    Reject = 'reject',
    Toggle_On = 'toggle_on',
    Toggle_Off = 'toggle_off',
    Selection = 'selection',
    Context_Click = 'context_click',
    Keyboard_Tap = 'keyboard_tap',
    Keyboard_Press = 'keyboard_press',
    Keyboard_Release = 'keyboard_release',
    Virtual_Key = 'virtual_key',
    Virtual_Key_Release = 'virtual_key_release',
    Long_Press = 'long_press',
    Gesture_Start = 'gesture_start',
    Gesture_End = 'gesture_end',
    Clock_Tick = 'clock_tick',
    Segment_Tick = 'segment_tick',
    Segment_Frequent_Tick = 'segment_frequent_tick',
    Text_Handle_Move = 'text_handle_move',
    Drag_Start = 'drag_start',
  }

  export function impactAsync(style?: ImpactFeedbackStyle): Promise<void>;
  export function notificationAsync(type?: NotificationFeedbackType): Promise<void>;
  export function selectionAsync(): Promise<void>;
  export function performAndroidHapticsAsync(type: AndroidHaptics): Promise<void>;
}
