import { Platform, Alert } from 'react-native';

/**
 * Cross-platform confirm dialog. Uses window.confirm on web, Alert.alert on native.
 * @param message The message to display
 * @param onConfirm Callback if user confirms
 */
export function confirmAction(message: string, onConfirm: () => void) {
    if (Platform.OS === 'web') {
        if (window.confirm(message)) {
            onConfirm();
        }
    } else {
        Alert.alert(
            'Confirm',
            message,
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'OK', onPress: onConfirm },
            ]
        );
    }
} 