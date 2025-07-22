# TextField Component

A comprehensive, production-ready text input component with advanced features, validation, and accessibility support.

## Features

### ✨ Core Features
- **Floating Labels**: Animated labels that float above the input when focused or filled
- **Material Design**: Follows Material Design principles with outlined and filled variants
- **Cross-Platform**: Optimized for both React Native and Web platforms
- **Accessibility**: Full accessibility support with proper labels, hints, and roles
- **Customizable**: Extensive theming and styling options

### 🎯 Advanced Features
- **Input Masking**: Built-in masks for phone numbers, credit cards, and currency
- **Password Strength**: Real-time password strength indicator
- **Character Counting**: Optional character count display
- **Debounced Validation**: Configurable debounced validation with loading states
- **Clear Button**: Optional clear button for easy input clearing
- **Custom Components**: Support for custom left and right components
- **Disabled State**: Full disabled state support
- **Helper Text**: Optional helper text below inputs
- **Validation States**: Error, success, and loading states with visual indicators

### 🔧 Technical Features
- **TypeScript**: Full TypeScript support with comprehensive type definitions
- **Performance**: Optimized with proper memoization and debouncing
- **Ref Forwarding**: Proper ref forwarding for focus management
- **Event Handling**: Comprehensive event handling with proper cleanup
- **State Management**: Robust internal state management

## Props

### Basic Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | The label text for the input |
| `icon` | `string` | - | Ionicons icon name |
| `iconColor` | `string` | - | Custom icon color |
| `error` | `string` | - | Error message to display |
| `success` | `boolean` | `false` | Whether to show success state |
| `loading` | `boolean` | `false` | Whether to show loading state |
| `variant` | `'outlined' \| 'filled'` | `'outlined'` | Input variant style |
| `disabled` | `boolean` | `false` | Whether the input is disabled |

### Enhanced Features
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `helperText` | `string` | - | Helper text displayed below input |
| `maxLength` | `number` | - | Maximum character limit |
| `showCharacterCount` | `boolean` | `false` | Show character count |
| `inputMask` | `'phone' \| 'creditCard' \| 'currency' \| 'custom'` | - | Input masking type |
| `customMask` | `(value: string) => string` | - | Custom masking function |
| `formatValue` | `(value: string) => string` | - | Custom value formatting |
| `validateOnChange` | `boolean` | `false` | Enable real-time validation |
| `debounceMs` | `number` | `300` | Debounce delay for validation |
| `passwordStrength` | `boolean` | `false` | Show password strength indicator |
| `clearable` | `boolean` | `false` | Show clear button |

### Accessibility Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `accessibilityLabel` | `string` | - | Accessibility label |
| `accessibilityHint` | `string` | - | Accessibility hint |
| `accessibilityRole` | `string` | `'text'` | Accessibility role |

### Advanced Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onValidationChange` | `(isValid: boolean, value: string) => void` | - | Validation change callback |
| `onClear` | `() => void` | - | Clear button callback |
| `autoFocus` | `boolean` | `false` | Auto focus on mount |
| `returnKeyType` | `'done' \| 'go' \| 'next' \| 'search' \| 'send'` | - | Return key type |
| `blurOnSubmit` | `boolean` | - | Blur on submit |
| `keyboardType` | `KeyboardTypeOptions` | - | Keyboard type |

### Styling Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `colors` | `object` | - | Color theme object |
| `containerStyle` | `StyleProp<ViewStyle>` | - | Container style |
| `inputStyle` | `StyleProp<TextStyle>` | - | Input style |
| `labelStyle` | `StyleProp<TextStyle>` | - | Label style |
| `errorStyle` | `StyleProp<ViewStyle>` | - | Error container style |

### Component Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `leftComponent` | `ReactNode` | - | Custom left component |
| `rightComponent` | `ReactNode` | - | Custom right component |

## Color Theme Object

```typescript
interface ColorTheme {
  primary: string;           // Primary color for focus states
  secondaryText: string;     // Secondary text color
  text: string;              // Main text color
  error: string;             // Error color
  success: string;           // Success color
  border: string;            // Border color
  inputBackground: string;   // Input background color
  disabled: string;          // Disabled text color
  disabledBackground: string; // Disabled background color
}
```

## Usage Examples

### Basic Usage
```tsx
import TextField from './TextField';

<TextField
  label="Username"
  value={username}
  onChangeText={setUsername}
  colors={colors}
/>
```

### With Icon and Validation
```tsx
<TextField
  label="Email"
  icon="mail-outline"
  value={email}
  onChangeText={setEmail}
  error={emailError}
  success={isEmailValid}
  colors={colors}
  variant="filled"
/>
```

### Password with Strength Indicator
```tsx
<TextField
  label="Password"
  icon="lock-closed-outline"
  value={password}
  onChangeText={setPassword}
  secureTextEntry={true}
  passwordStrength={true}
  colors={colors}
  helperText="Enter a strong password"
/>
```

### Phone Number with Mask
```tsx
<TextField
  label="Phone Number"
  icon="call-outline"
  value={phone}
  onChangeText={setPhone}
  inputMask="phone"
  keyboardType="phone-pad"
  colors={colors}
/>
```

### Credit Card with Character Count
```tsx
<TextField
  label="Credit Card"
  icon="card-outline"
  value={creditCard}
  onChangeText={setCreditCard}
  inputMask="creditCard"
  keyboardType="numeric"
  maxLength={19}
  showCharacterCount={true}
  colors={colors}
/>
```

### Real-time Validation
```tsx
<TextField
  label="Username"
  icon="person-outline"
  value={username}
  onChangeText={setUsername}
  error={usernameError}
  success={isUsernameValid}
  loading={isValidating}
  validateOnChange={true}
  debounceMs={500}
  onValidationChange={(isValid, value) => {
    // Handle validation result
  }}
  colors={colors}
/>
```

### Disabled State
```tsx
<TextField
  label="Disabled Field"
  value="This field is disabled"
  onChangeText={() => {}}
  disabled={true}
  colors={colors}
  helperText="This field cannot be edited"
/>
```

### Custom Right Component
```tsx
<TextField
  label="With Custom Button"
  icon="add-circle-outline"
  value={value}
  onChangeText={setValue}
  colors={colors}
  rightComponent={
    <TouchableOpacity 
      style={styles.customButton}
      onPress={handleCustomAction}
    >
      <Text style={styles.customButtonText}>Add</Text>
    </TouchableOpacity>
  }
/>
```

### Multiline Input
```tsx
<TextField
  label="Bio"
  icon="document-text-outline"
  value={bio}
  onChangeText={setBio}
  multiline={true}
  numberOfLines={4}
  maxLength={500}
  showCharacterCount={true}
  colors={colors}
  helperText="Tell us about yourself"
/>
```

## Input Masks

### Built-in Masks

#### Phone Number
```tsx
inputMask="phone"
// Input: 1234567890
// Output: (123) 456-7890
```

#### Credit Card
```tsx
inputMask="creditCard"
// Input: 1234567890123456
// Output: 1234 5678 9012 3456
```

#### Currency
```tsx
inputMask="currency"
// Input: 123.45
// Output: $123.45
```

### Custom Mask
```tsx
const customMask = (value: string) => {
  // Your custom formatting logic
  return formattedValue;
};

<TextField
  inputMask="custom"
  customMask={customMask}
  // ... other props
/>
```

## Password Strength

The password strength indicator provides real-time feedback on password strength:

- **Weak (0-25%)**: Red
- **Fair (26-50%)**: Orange  
- **Good (51-75%)**: Blue
- **Strong (76-100%)**: Green

```tsx
<TextField
  label="Password"
  secureTextEntry={true}
  passwordStrength={true}
  // ... other props
/>
```

## Validation

### Real-time Validation
```tsx
const [emailError, setEmailError] = useState('');
const [isEmailValid, setIsEmailValid] = useState(false);

<TextField
  label="Email"
  value={email}
  onChangeText={setEmail}
  error={emailError}
  success={isEmailValid}
  validateOnChange={true}
  debounceMs={500}
  onValidationChange={(isValid, value) => {
    if (isValid) {
      setIsEmailValid(true);
      setEmailError('');
    } else {
      setIsEmailValid(false);
      setEmailError('Please enter a valid email address');
    }
  }}
/>
```

## Accessibility

The component includes comprehensive accessibility support:

- Proper accessibility labels and hints
- Keyboard navigation support
- Screen reader compatibility
- Focus management
- Disabled state handling

```tsx
<TextField
  label="Username"
  accessibilityLabel="Enter your username"
  accessibilityHint="Username must be at least 3 characters long"
  accessibilityRole="text"
  // ... other props
/>
```

## Focus Management

```tsx
const inputRef = useRef<TextInput>(null);

<TextField
  ref={inputRef}
  label="Username"
  // ... other props
/>

// Focus the input
inputRef.current?.focus();
```

## Styling

### Custom Colors
```tsx
const colors = {
  primary: '#d169e5',
  secondaryText: '#666666',
  text: '#000000',
  error: '#D32F2F',
  success: '#2E7D32',
  border: '#E0E0E0',
  inputBackground: '#F5F5F5',
  disabled: '#E0E0E0',
  disabledBackground: '#F5F5F5',
};

<TextField
  colors={colors}
  // ... other props
/>
```

### Custom Styles
```tsx
<TextField
  containerStyle={{ marginBottom: 20 }}
  inputStyle={{ fontSize: 18 }}
  labelStyle={{ fontWeight: 'bold' }}
  errorStyle={{ backgroundColor: '#ffebee' }}
  // ... other props
/>
```

## Best Practices

1. **Always provide labels** for accessibility
2. **Use appropriate keyboard types** for different input types
3. **Implement proper validation** with user-friendly error messages
4. **Use debouncing** for real-time validation to avoid performance issues
5. **Provide helper text** for complex inputs
6. **Handle disabled states** appropriately
7. **Use consistent color themes** across your app
8. **Test accessibility** with screen readers

## Performance Considerations

- The component uses `useCallback` and `useMemo` for performance optimization
- Debouncing is built-in for validation to prevent excessive re-renders
- Proper cleanup of timers and animations
- Efficient state management to minimize re-renders

## Browser Support

- React Native: All supported platforms
- Web: Modern browsers with React Native Web support
- Mobile: iOS and Android with proper keyboard handling

## Dependencies

- React Native
- @expo/vector-icons (for icons)
- react-native-svg (for border rendering)

## Migration from Previous Version

The improved TextField component is mostly backward compatible. Key changes:

1. **New props**: Added many new features while maintaining existing API
2. **Better TypeScript**: Improved type definitions
3. **Enhanced accessibility**: Better accessibility support
4. **Performance improvements**: Optimized rendering and state management
5. **Removed web-specific code**: Unified implementation for all platforms

Existing code should continue to work with minimal changes. 