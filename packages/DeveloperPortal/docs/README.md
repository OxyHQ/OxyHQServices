# Documentation System

This directory contains all documentation for the Oxy Developer Portal, organized in a Docusaurus-style file-based system.

## 📁 Structure

```
docs/
├── config.ts              # Configuration and types
├── index.ts               # Main export file
├── getting-started/       # Getting started guides
│   ├── introduction.ts
│   └── quick-start.ts
├── api-basics/           # API fundamentals
├── api-reference/        # Complete API reference
├── client-libraries/     # Client SDK documentation
└── best-practices/       # Best practices and guides
```

## 🎯 How It Works

### 1. Configuration (`config.ts`)

Defines types and categories:
- `DocPage`: Type for documentation pages
- `DocSection`: Type for page sections
- `ExternalDoc`: Type for external documentation links
- `docCategories`: Array of documentation categories with order
- `externalDocs`: Array of external documentation (Mention, Homiio, etc.)

### 2. Documentation Files

Each documentation page is a TypeScript file that exports a `DocPage` object:

```typescript
import { DocPage } from '../config';

export const myDoc: DocPage = {
  id: 'my-doc',
  title: 'My Documentation',
  description: 'Brief description',
  category: 'getting-started',
  icon: 'book-outline',
  iconColor: '#007AFF',
  content: {
    introduction: 'Introduction text...',
    sections: [
      {
        id: 'section-1',
        title: 'Section Title',
        content: 'Section content...',
        code: 'optional code example',
        language: 'javascript',
        tip: 'Optional tip',
        warning: 'Optional warning',
        note: 'Optional note',
      },
    ],
  },
};
```

### 3. Index File (`index.ts`)

Imports all documentation files and exports them as an array:

```typescript
import { introduction } from './getting-started/introduction';
import { quickStart } from './getting-started/quick-start';

export const allDocs: DocPage[] = [
  introduction,
  quickStart,
  // Add more docs here
];
```

## ➕ Adding New Documentation

### Step 1: Create the file

Create a new `.ts` file in the appropriate category folder:

```bash
# Example: Adding authentication docs
touch docs/api-basics/authentication.ts
```

### Step 2: Write the documentation

```typescript
import { DocPage } from '../config';

const baseURL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export const authentication: DocPage = {
  id: 'authentication',
  title: 'Authentication',
  description: 'Learn how to authenticate your API requests',
  category: 'api-basics',
  icon: 'key-outline',
  iconColor: '#FF9500',
  content: {
    introduction: 'All API requests must be authenticated...',
    sections: [
      {
        id: 'bearer-auth',
        title: 'Bearer Token Authentication',
        content: 'Include your App ID in the Authorization header...',
        code: `Authorization: Bearer YOUR_APP_ID`,
        language: 'text',
      },
      // More sections...
    ],
  },
};
```

### Step 3: Export from index.ts

Add the import and include in `allDocs`:

```typescript
// In docs/index.ts
import { authentication } from './api-basics/authentication';

export const allDocs: DocPage[] = [
  introduction,
  quickStart,
  authentication, // Add here
  // ...
];
```

That's it! The documentation will automatically appear in the sidebar under the correct category.

## 🎨 UI Features

### Sidebar

The sidebar uses the `GroupedSection` component (same as Quick Links in RightBar):
- Shows icon with custom color
- Displays title and description
- Shows chevron for navigation
- Highlights selected page
- Supports external links with external icon

### Content Rendering

- **Code blocks**: Automatically rendered with monospace font
- **Callouts**: Tips (green), Warnings (orange), Notes (blue)
- **Breadcrumbs**: Automatic navigation trail
- **Pagination**: Previous/Next buttons
- **Search**: Real-time search across all content

## 🔍 Search

The search functionality searches across:
- Page titles (highest priority)
- Page descriptions
- Section titles and content
- Code blocks

Results show match type badges (title/description/content/code) and context.

## 🌐 External Documentation

Add external documentation links in `config.ts`:

```typescript
export const externalDocs: ExternalDoc[] = [
  {
    id: 'my-app',
    title: 'My App Documentation',
    description: 'Integrate with My App',
    category: 'ecosystem',
    url: 'https://myapp.com/docs',
    icon: 'rocket',
    iconColor: '#FF9500',
  },
];
```

External docs appear in the sidebar with an external link icon.

## 📋 Categories

Categories are defined in `config.ts` with display order:

```typescript
export const docCategories: DocCategory[] = [
  { id: 'getting-started', title: 'Getting Started', order: 1 },
  { id: 'api-basics', title: 'API Basics', order: 2 },
  // ...
];
```

## 💡 Tips

1. **Icons**: Use Ionicons icon names (e.g., 'book-outline', 'rocket-outline')
2. **Colors**: Use hex colors for consistent branding
3. **Code**: Always specify language for proper formatting
4. **Descriptions**: Keep them concise (1-2 sentences)
5. **Sections**: Break content into logical, digestible sections
6. **Order**: docs appear in the order they're added to `allDocs` array

## 🚀 Benefits

1. **File-based**: Easy to organize and maintain
2. **Type-safe**: TypeScript ensures correctness
3. **Modular**: Each doc is independent
4. **Searchable**: Automatically indexed for search
5. **Scalable**: Add docs without modifying UI code
6. **Version control**: Changes are tracked in git

## 📝 Example: Complete Documentation Page

See `docs/getting-started/introduction.ts` for a complete example with all features.
