/**
 * OxyHQServices Main Export File - Universal (Frontend + Backend)
 * 
 * This exports everything but uses environment detection to avoid crashes.
 * - Frontend: Full UI + Core functionality
 * - Backend: Core functionality only (UI components are no-ops)
 */

// Universal entry: always statically export everything
export * from './core';
export * from './ui';
export { toast } from './lib/sonner-safe';