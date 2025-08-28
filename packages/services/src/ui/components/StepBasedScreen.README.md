# StepBasedScreen Component

A reusable, production-ready React Native component for building multi-step flows with smooth animations and consistent UX patterns.

## 🚀 Features

- **Smooth Animations**: Built-in fade/slide animations using React Native Reanimated
- **Progress Indicators**: Automatic progress bars and step indicators
- **Type Safety**: Full TypeScript support with comprehensive interfaces
- **Flexible Configuration**: Highly customizable step definitions
- **Performance Optimized**: Efficient re-rendering and memory management
- **Accessibility**: Proper focus management and screen reader support

## 📦 Installation

The component is already integrated into your project structure. Simply import it:

```typescript
import StepBasedScreen, { type StepConfig } from '../components/StepBasedScreen';
```

## 🔧 Basic Usage

```typescript
import React, { useState, useCallback } from 'react';
import StepBasedScreen, { type StepConfig } from './StepBasedScreen';

const MyMultiStepScreen: React.FC = () => {
    const [formData, setFormData] = useState({ name: '', email: '' });

    // Define your step components
    const Step1: React.FC<any> = ({ nextStep }) => (
        <View>
            <Text>Enter your name</Text>
            <TextInput
                value={formData.name}
                onChangeText={(text) => setFormData(prev => ({ ...prev, name: text }))}
            />
            <Button title="Next" onPress={nextStep} />
        </View>
    );

    const Step2: React.FC<any> = ({ prevStep, onComplete }) => (
        <View>
            <Text>Enter your email</Text>
            <TextInput
                value={formData.email}
                onChangeText={(text) => setFormData(prev => ({ ...prev, email: text }))}
            />
            <Button title="Back" onPress={prevStep} />
            <Button title="Complete" onPress={onComplete} />
        </View>
    );

    // Configure your steps
    const steps: StepConfig[] = [
        {
            id: 'name',
            component: Step1,
            canProceed: () => formData.name.trim().length > 0,
        },
        {
            id: 'email',
            component: Step2,
            canProceed: () => formData.email.trim().length > 0,
        },
    ];

    const handleComplete = useCallback((stepData: any[]) => {
        console.log('Form completed with data:', stepData);
        // Handle completion logic here
    }, []);

    return (
        <StepBasedScreen
            steps={steps}
            stepData={[formData]}
            onComplete={handleComplete}
            showProgressIndicator={true}
            enableAnimations={true}
        />
    );
};
```

## 🎛️ API Reference

### StepBasedScreen Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `steps` | `StepConfig[]` | **Required** | Array of step configurations |
| `stepData` | `any[]` | `[]` | Data to pass to each step |
| `initialStep` | `number` | `0` | Initial step index |
| `onComplete` | `(stepData: any[]) => void` | - | Called when all steps are completed |
| `onStepChange` | `(currentStep: number, totalSteps: number) => void` | - | Called when step changes |
| `showProgressIndicator` | `boolean` | `true` | Show progress bar/indicator |
| `enableAnimations` | `boolean` | `true` | Enable step transition animations |
| `navigate` | `(screen: string, props?: any) => void` | **Required** | Navigation function |
| `goBack` | `() => void` | - | Go back function |
| `onAuthenticated` | `(user: any) => void` | - | Authentication callback |
| `theme` | `string` | **Required** | Theme ('light' or 'dark') |

### StepConfig Interface

```typescript
interface StepConfig {
    id: string;                                    // Unique identifier for the step
    component: React.ComponentType<any>;           // React component to render
    props?: Record<string, any>;                  // Additional props for the component
    canProceed?: (stepData?: any) => boolean;     // Validation function
    onEnter?: () => void;                         // Called when entering this step
    onExit?: () => void;                          // Called when exiting this step
}
```

### Step Component Props

Each step component receives these props automatically:

```typescript
interface StepComponentProps {
    // Navigation
    nextStep: () => void;
    prevStep: () => void;
    goToStep: (stepIndex: number) => void;
    currentStep: number;
    totalSteps: number;

    // Data management
    stepData?: any;
    updateStepData: (data: any) => void;
    allStepData: any[];

    // State
    isTransitioning: boolean;

    // Common props
    colors: any;
    styles: any;
    theme: string;
    navigate: (screen: string, props?: any) => void;
    goBack: () => void;
    onAuthenticated: (user: any) => void;

    // Animation refs (advanced usage)
    fadeAnim: Animated.SharedValue<number>;
    slideAnim: Animated.SharedValue<number>;
    scaleAnim: Animated.SharedValue<number>;
}
```

## 📱 Advanced Usage Examples

### Conditional Steps

```typescript
const steps: StepConfig[] = [
    {
        id: 'basic-info',
        component: BasicInfoStep,
        canProceed: (data) => data?.name && data?.email,
    },
    {
        id: 'verification',
        component: VerificationStep,
        canProceed: (data) => data?.verified,
        onEnter: () => {
            // Send verification code
            sendVerificationCode();
        },
    },
    // Only show if user selected premium
    ...(userType === 'premium' ? [{
        id: 'premium-setup',
        component: PremiumSetupStep,
        canProceed: () => true,
    }] : []),
];
```

### Async Validation

```typescript
const steps: StepConfig[] = [
    {
        id: 'username',
        component: UsernameStep,
        canProceed: async (data) => {
            if (!data?.username) return false;
            const isAvailable = await checkUsernameAvailability(data.username);
            return isAvailable;
        },
        onEnter: () => {
            // Pre-validate if username exists
            if (existingUsername) {
                validateUsername(existingUsername);
            }
        },
    },
];
```

### Dynamic Step Data

```typescript
const [stepData, setStepData] = useState([
    { name: '', email: '' },           // Step 1 data
    { preferences: {} },               // Step 2 data
    { confirmation: false },           // Step 3 data
]);

// Update specific step data
const updateStepData = (stepIndex: number, data: any) => {
    setStepData(prev => prev.map((item, index) =>
        index === stepIndex ? { ...item, ...data } : item
    ));
};
```

### Custom Progress Indicator

```typescript
const CustomProgressIndicator: React.FC<{
    currentStep: number;
    totalSteps: number;
    colors: any;
}> = ({ currentStep, totalSteps, colors }) => (
    <View style={styles.customProgress}>
        {Array.from({ length: totalSteps }, (_, index) => (
            <View
                key={index}
                style={[
                    styles.progressDot,
                    {
                        backgroundColor: index <= currentStep ? colors.primary : colors.border,
                        transform: [{ scale: index === currentStep ? 1.2 : 1 }],
                    }
                ]}
            />
        ))}
    </View>
);

// Use in your screen component
<StepBasedScreen
    steps={steps}
    showProgressIndicator={false} // Disable default indicator
    // Add your custom indicator as a step component
/>
```

## 🎨 Styling

The component uses your existing theme system and `createAuthStyles`. All styling is consistent with your app's design system.

### Customizing Animations

```typescript
// The component includes optimized animations by default
// For custom animations, access the animation refs in your step components:

const MyStepComponent: React.FC<any> = ({
    fadeAnim,
    slideAnim,
    scaleAnim,
    isTransitioning
}) => {
    const customAnimatedStyle = useAnimatedStyle(() => ({
        opacity: fadeAnim.value,
        transform: [
            { translateX: slideAnim.value },
            { scale: scaleAnim.value },
            // Add your custom transforms here
        ],
    }));

    return (
        <Animated.View style={customAnimatedStyle}>
            {/* Your step content */}
        </Animated.View>
    );
};
```

## 🐛 Troubleshooting

### Common Issues

1. **Steps not advancing**: Check your `canProceed` functions return `true`
2. **Animations not working**: Ensure `enableAnimations` is `true` and Reanimated is properly set up
3. **TypeScript errors**: Make sure your step components accept the `StepComponentProps` interface
4. **Re-rendering issues**: Use `useCallback` for functions passed to step components

### Performance Tips

1. **Memoize step components**: Use `React.memo` for step components
2. **Optimize re-renders**: Only include necessary dependencies in `useMemo` and `useCallback`
3. **Limit step data**: Keep `stepData` as small as possible
4. **Use proper keys**: Ensure step components have unique keys for proper reconciliation

## 🔄 Migration from Existing Screens

### Converting SignInScreen

1. Extract step components into separate files
2. Define step configurations with validation logic
3. Replace the existing component with `StepBasedScreen`
4. Pass form state through `stepData`

### Converting SignUpScreen

1. Break down the 4-step flow into separate components
2. Implement validation logic in `canProceed` functions
3. Handle form state management in the parent component
4. Use `onEnter` and `onExit` for step-specific logic

## 📚 Related Components

- `TextField` - Input component used in steps
- `GroupedPillButtons` - Navigation buttons
- `ProgressIndicator` - Built-in progress component
- `AnimatedStepContainer` - Animation wrapper

## 🤝 Contributing

When adding new features to the StepBasedScreen:

1. Maintain backward compatibility
2. Add comprehensive TypeScript types
3. Include examples in the examples file
4. Update this documentation
5. Test with different step configurations

---

**Note**: This component is designed to be highly reusable across different multi-step flows in your application. It handles the common patterns of navigation, animation, and state management, allowing you to focus on the specific logic for each step.
