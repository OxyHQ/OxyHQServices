import type { Animated } from 'react-native';

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
    icon: string;
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
    background?: string;
}
