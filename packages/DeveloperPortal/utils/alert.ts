import { Platform, Alert as RNAlert } from 'react-native';

/**
 * Cross-platform alert/confirm utility
 * Works on iOS, Android, and Web
 */
export const Alert = {
  alert: (
    title: string,
    message?: string,
    buttons?: Array<{ text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }>
  ) => {
    if (Platform.OS === 'web') {
      // Web implementation
      const buttonText = buttons?.map(b => b.text).join(' / ') || 'OK';
      const fullMessage = message ? `${title}\n\n${message}` : title;
      
      if (buttons && buttons.length > 1) {
        // Use confirm for multiple buttons
        const confirmed = window.confirm(fullMessage);
        const button = buttons.find(b => b.style === (confirmed ? 'destructive' : 'cancel')) || buttons[0];
        button?.onPress?.();
      } else {
        // Use alert for single button
        window.alert(fullMessage);
        buttons?.[0]?.onPress?.();
      }
    } else {
      // Native implementation
      RNAlert.alert(title, message, buttons);
    }
  },

  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
    confirmText: string = 'Confirm',
    cancelText: string = 'Cancel'
  ) => {
    if (Platform.OS === 'web') {
      const result = window.confirm(`${title}\n\n${message}`);
      if (result) {
        onConfirm();
      } else {
        onCancel?.();
      }
    } else {
      RNAlert.alert(title, message, [
        { text: cancelText, style: 'cancel', onPress: onCancel },
        { text: confirmText, style: 'destructive', onPress: onConfirm },
      ]);
    }
  },
};
