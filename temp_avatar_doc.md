## Avatar

A versatile avatar component that displays either an image or text-based avatar. It falls back to displaying the first letter of a user's name when no image is provided.

```tsx
import { Avatar } from '@oxyhq/services';

// Image avatar
<Avatar 
  imageUrl="https://example.com/avatar.jpg"
  size={40}
  theme="light"
/>

// Text avatar with name
<Avatar 
  name="John Doe"
  size={64}
  theme="dark"
/>

// Custom text avatar with colors
<Avatar 
  text="JS"
  backgroundColor="#0066CC"
  textColor="#FFFFFF"
  size={50}
/>

// Loading state
<Avatar 
  isLoading={true}
  size={40}
/>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| imageUrl | `string` | `undefined` | URL of the avatar image |
| text | `string` | `undefined` | Text to display when no image is available |
| name | `string` | `undefined` | Full name to derive the initials from (takes first letter) |
| size | `number` | `40` | Size of the avatar in pixels |
| theme | `'light' \| 'dark'` | `'light'` | Theme to use for colors |
| backgroundColor | `string` | Theme primary color | Background color for text avatar |
| textColor | `string` | `'#FFFFFF'` | Text color for text avatar |
| style | `StyleProp<ViewStyle>` | `undefined` | Additional styles for the container |
| textStyle | `StyleProp<TextStyle>` | `undefined` | Additional styles for the text |
| isLoading | `boolean` | `false` | Whether to show loading indicator |
