import type React from 'react';
import type { Animated } from 'react-native';
import type { Ionicons } from '@expo/vector-icons';

export type PaymentItem = {
    type: 'product' | 'subscription' | 'service' | 'fee' | string;
    name: string;
    description?: string;
    quantity?: number;
    period?: string;
    price: number;
    currency?: string;
};

export interface PaymentGatewayResult {
    success: boolean;
    details?: Record<string, string | number | boolean | null>;
    error?: string;
}

export interface CardDetails {
    number: string;
    expiry: string;
    cvv: string;
}

export interface PaymentMethod {
    key: string;
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    description: string;
}

export interface PaymentStepAnimations {
    fadeAnim: Animated.Value;
    slideAnim: Animated.Value;
    scaleAnim: Animated.Value;
}

export interface PaymentColors {
    primary: string;
    text: string;
    secondaryText: string;
    border: string;
    success?: string;
    error?: string;
    background?: string;
    card?: string;
}
