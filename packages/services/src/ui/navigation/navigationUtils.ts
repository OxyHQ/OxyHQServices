import { routes, routeNames } from './routes';
import type { RouteName } from './routes';

// Create a Set for O(1) route name lookups
const routeNameSet = new Set(routeNames);

// Pre-compute valid routes string for error messages (only computed once)
export const VALID_ROUTES_STRING = routeNames.join(', ');

// Empty object constant to avoid creating new objects
export const EMPTY_PROPS = Object.freeze({}) as Record<string, unknown>;

/**
 * Validates if a string is a valid route name
 */
export const isValidRouteName = (screen: string): screen is RouteName => {
    return routeNameSet.has(screen as RouteName);
};

/**
 * Validates route and logs errors if invalid
 * @returns true if route is valid, false otherwise
 */
export const validateRoute = (screen: string): screen is RouteName => {
    if (!isValidRouteName(screen)) {
        console.error('OxyRouter:', `Invalid route name: "${screen}". Valid routes are: ${VALID_ROUTES_STRING}`);
        return false;
    }

    const route = routes[screen as RouteName];
    if (!route) {
        console.error('OxyRouter:', `Route "${screen}" is registered but component is missing`);
        return false;
    }

    return true;
};

