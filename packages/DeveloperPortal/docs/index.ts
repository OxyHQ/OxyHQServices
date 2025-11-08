import { DocPage, externalDocs, docCategories } from './config';

// Getting Started
import { introduction } from './getting-started/introduction';
import { quickStart } from './getting-started/quick-start';

// Import other docs as you create them
// import { authentication } from './api-basics/authentication';
// import { webhooks } from './api-basics/webhooks';
// etc.

// All documentation pages
export const allDocs: DocPage[] = [
  introduction,
  quickStart,
  // Add more docs here as you create them
];

// Export types and configuration
export type { DocPage } from './config';
export { externalDocs, docCategories };

// Helper to get docs by category
export const getDocsByCategory = (categoryId: string): DocPage[] => {
  return allDocs.filter(doc => doc.category === categoryId);
};

// Helper to get doc by ID
export const getDocById = (id: string): DocPage | undefined => {
  return allDocs.find(doc => doc.id === id);
};

// Get all categories that have docs
export const getActiveCategories = () => {
  const categoriesWithDocs = new Set(allDocs.map(doc => doc.category));
  const categoriesWithExternal = new Set(externalDocs.map(doc => doc.category));
  
  return docCategories
    .filter(cat => categoriesWithDocs.has(cat.id) || categoriesWithExternal.has(cat.id))
    .sort((a, b) => a.order - b.order);
};
