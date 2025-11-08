import { Ionicons } from '@expo/vector-icons';

export interface DocSection {
  id: string;
  title: string;
  content: string;
  code?: string;
  language?: string;
  note?: string;
  warning?: string;
  tip?: string;
}

export interface DocPage {
  id: string;
  title: string;
  description: string;
  category: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  content: {
    introduction: string;
    sections: DocSection[];
  };
}

export interface ExternalDoc {
  id: string;
  title: string;
  description: string;
  category: string;
  url: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
}

export interface DocCategory {
  id: string;
  title: string;
  order: number;
}

// Define categories with order
export const docCategories: DocCategory[] = [
  { id: 'getting-started', title: 'Getting Started', order: 1 },
  { id: 'api-basics', title: 'API Basics', order: 2 },
  { id: 'api-reference', title: 'API Reference', order: 3 },
  { id: 'client-libraries', title: 'Client Libraries', order: 4 },
  { id: 'best-practices', title: 'Best Practices', order: 5 },
  { id: 'ecosystem', title: 'Ecosystem Apps', order: 6 },
];

// External documentation links
export const externalDocs: ExternalDoc[] = [
  {
    id: 'mention',
    title: 'Mention Social Network',
    description: 'Build integrations with Mention',
    category: 'ecosystem',
    url: 'https://mention.earth/docs',
    icon: 'people',
    iconColor: '#007AFF',
  },
  {
    id: 'homiio',
    title: 'Homiio',
    description: 'Integrate with Homiio',
    category: 'ecosystem',
    url: 'https://homiio.com/docs',
    icon: 'home',
    iconColor: '#34C759',
  },
];

// Get category by ID
export const getCategoryById = (id: string): DocCategory | undefined => {
  return docCategories.find(cat => cat.id === id);
};

// Get category title by ID
export const getCategoryTitle = (id: string): string => {
  const category = getCategoryById(id);
  return category?.title || id;
};
