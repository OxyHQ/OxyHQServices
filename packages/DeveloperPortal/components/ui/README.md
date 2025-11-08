# UI Components

Reusable, cross-platform UI components for the Developer Portal.

## Components

### Button
Flexible button component with multiple variants and sizes.

**Props:**
- `title` (string): Button text
- `onPress` (function): Click handler
- `variant` ('primary' | 'secondary' | 'danger' | 'warning' | 'ghost'): Visual style
- `size` ('small' | 'medium' | 'large'): Button size
- `icon` (Ionicons name): Optional icon
- `iconPosition` ('left' | 'right'): Icon placement
- `loading` (boolean): Show loading spinner
- `disabled` (boolean): Disable interaction
- `fullWidth` (boolean): Expand to full width

**Example:**
```tsx
import { Button } from '@/components';

<Button
  title="Create App"
  onPress={handleCreate}
  variant="primary"
  icon="add-circle"
  loading={isLoading}
/>
```

### IconButton
Compact button with just an icon.

**Props:**
- `icon` (Ionicons name): Icon to display
- `onPress` (function): Click handler
- `variant` ('primary' | 'secondary' | 'danger' | 'ghost'): Visual style
- `size` ('small' | 'medium' | 'large'): Button size
- `disabled` (boolean): Disable interaction

**Example:**
```tsx
import { IconButton } from '@/components';

<IconButton
  icon="trash-outline"
  onPress={handleDelete}
  variant="danger"
  size="small"
/>
```

### Card
Container component with elevation and theming.

**Props:**
- `children` (ReactNode): Card content
- `onPress` (function, optional): Make card interactive
- `variant` ('default' | 'outlined' | 'elevated'): Card style

**Example:**
```tsx
import { Card } from '@/components';

<Card variant="elevated" onPress={() => navigate('/details')}>
  <Text>Card Content</Text>
</Card>
```

### Input
Text input with label, validation, and theming.

**Props:**
- `label` (string): Input label
- `value` (string): Current value
- `onChangeText` (function): Value change handler
- `placeholder` (string): Placeholder text
- `helperText` (string): Helper text below input
- `error` (string): Error message
- `multiline` (boolean): Multi-line input
- `keyboardType` ('default' | 'email-address' | 'numeric' | 'url'): Keyboard type
- `secureTextEntry` (boolean): Hide input (for passwords)
- `disabled` (boolean): Disable editing

**Example:**
```tsx
import { Input } from '@/components';

<Input
  label="App Name"
  value={name}
  onChangeText={setName}
  placeholder="My Awesome App"
  error={nameError}
/>
```

### Badge
Small label for status, counts, or categories.

**Props:**
- `label` (string): Badge text
- `variant` ('primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'): Visual style
- `size` ('small' | 'medium' | 'large'): Badge size

**Example:**
```tsx
import { Badge } from '@/components';

<Badge label="Active" variant="success" />
<Badge label="3" variant="primary" size="small" />
```

### Collapsible
Expandable/collapsible content section.

**Example:**
```tsx
import { Collapsible } from '@/components';

<Collapsible title="Advanced Options">
  <Text>Hidden content</Text>
</Collapsible>
```

### IconSymbol
Platform-specific icon rendering (iOS SF Symbols).

### Loading
Loading spinner with optional message.

**Props:**
- `message` (string): Optional loading message
- `size` ('small' | 'large'): Spinner size
- `fullScreen` (boolean): Take up full screen

**Example:**
```tsx
import { Loading } from '@/components';

<Loading message="Loading apps..." fullScreen />
```

### EmptyState
Display when there's no content to show.

**Props:**
- `icon` (Ionicons name): Icon to display
- `title` (string): Main message
- `message` (string): Secondary message
- `action` (ReactNode): Optional action button

**Example:**
```tsx
import { EmptyState, Button } from '@/components';

<EmptyState
  icon="cube-outline"
  title="No Apps Yet"
  message="Create your first developer app"
  action={<Button title="Create App" onPress={handleCreate} />}
/>
```

### InfoRow
Display label-value pairs with optional action.

**Props:**
- `icon` (Ionicons name): Icon for the label
- `label` (string): Label text
- `value` (string): Value text
- `onPress` (function, optional): Action handler
- `actionIcon` (Ionicons name): Icon for action (default: 'copy-outline')

**Example:**
```tsx
import { InfoRow } from '@/components';

<InfoRow
  icon="key-outline"
  label="API Key"
  value={apiKey}
  onPress={() => copyToClipboard(apiKey)}
/>
```

### Divider
Horizontal line separator.

**Props:**
- `spacing` ('small' | 'medium' | 'large'): Vertical spacing around divider

**Example:**
```tsx
import { Divider } from '@/components';

<Divider spacing="large" />
```

## Design Principles

1. **Cross-platform**: All components work on iOS, Android, and Web
2. **Theming**: Automatic dark/light mode support
3. **Accessibility**: Proper touch targets and labels
4. **Consistency**: Unified spacing, colors, and typography
5. **Composability**: Components work well together

## Styling

Components use the theme colors from `@/constants/theme`:
- Primary: `#007AFF`
- Success: `#34C759`
- Warning: `#FF9500`
- Danger: `#FF3B30`
- Info: `#5AC8FA`

Dark mode is automatically handled through `useColorScheme()`.
