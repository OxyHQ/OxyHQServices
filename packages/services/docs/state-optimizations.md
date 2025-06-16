# State Management Optimizations

This document outlines the state management optimizations implemented in OxyHQServices to reduce re-renders, optimize updates, and improve memory usage.

## Overview

The state management optimizations include:

1. **Selective Subscription System** - Only re-render components when specific state slices change
2. **State Diffing Mechanisms** - Efficiently determine what has changed and update only necessary parts
3. **Memory Management** - Garbage collection for unused state data and automatic cleanup
4. **Performance Monitoring** - Tools to track and debug component performance

## Core Utilities

### Selective Subscriptions

Create subscriptions that only notify when selected values change:

```typescript
import { createSelectiveSubscription } from '@oxyhq/services';

const subscription = createSelectiveSubscription({ 
  user: null, 
  sessions: [], 
  isLoading: false 
});

// Subscribe to only user changes
const unsubscribe = subscription.subscribe(
  (state) => state.user,
  (newUser, prevUser) => {
    console.log('User changed:', newUser);
  }
);

// Update state - only user subscribers will be notified
subscription.setState({ 
  user: { id: 1, name: 'John' }, 
  sessions: [], 
  isLoading: false 
});
```

### State Diffing

Efficiently detect changes in complex state objects:

```typescript
import { createStateDiff } from '@oxyhq/services';

const prevState = { count: 1, user: { name: 'John' }, items: [] };
const newState = { count: 2, user: { name: 'John' }, items: ['item1'] };

const diff = createStateDiff(prevState, newState, true); // deep comparison

console.log(diff.hasChanges); // true
console.log(diff.changedKeys); // ['count', 'items']
console.log(diff.previousValues); // { count: 1, items: [] }
console.log(diff.currentValues); // { count: 2, items: ['item1'] }
```

### Optimized Memoization

Use memoization with automatic cleanup to prevent memory leaks:

```typescript
import { useOptimizedMemo } from '@oxyhq/services';

function ExpensiveComponent({ data, theme }) {
  const processedData = useOptimizedMemo(
    () => {
      // Expensive computation
      return data.map(item => ({ 
        ...item, 
        processed: true,
        theme: theme 
      }));
    },
    [data, theme],
    { 
      shallow: true, 
      debugName: 'DataProcessing',
      enableLogging: process.env.NODE_ENV === 'development'
    }
  );

  return <div>{/* render processedData */}</div>;
}
```

### Garbage Collection

Automatically clean up unused state data:

```typescript
import { StateGarbageCollector } from '@oxyhq/services';

const gc = new StateGarbageCollector({
  maxAge: 5 * 60 * 1000, // 5 minutes
  maxSize: 100, // max 100 items
  cleanupInterval: 60 * 1000 // cleanup every minute
});

// Store data
gc.set('user:123', { id: 123, name: 'John' });

// Retrieve data
const user = gc.get('user:123');

// Automatic cleanup happens based on age and size limits
// Manual cleanup
const removedCount = gc.cleanup();

// Clean up when done
gc.destroy();
```

### Performance Monitoring

Track component render performance:

```typescript
import { StatePerformanceMonitor } from '@oxyhq/services';

const monitor = new StatePerformanceMonitor();

function MyComponent() {
  useEffect(() => {
    monitor.startRender('MyComponent');
    return () => {
      monitor.endRender('MyComponent');
    };
  });

  // Component logic
  
  // Get performance metrics
  const metrics = monitor.getMetrics('MyComponent');
  console.log('Avg render time:', metrics.averageRenderTime);
  console.log('Slow renders:', metrics.slowRenders);
  
  return <div>My Component</div>;
}
```

## Best Practices

### 1. Use Selective Subscriptions for Large State Objects

Instead of subscribing to the entire state:

```typescript
// ❌ Bad - re-renders on any state change
const { user, sessions, loading, error } = useOxy();

// ✅ Good - only re-renders when user changes
const user = useOxySelector(state => state.user);
```

### 2. Implement State Diffing for Complex Updates

```typescript
// ❌ Bad - no change detection
useEffect(() => {
  updateComponent();
}, [complexObject]);

// ✅ Good - only update when actually changed
const prevComplexObject = useRef(complexObject);
useEffect(() => {
  const diff = createStateDiff(prevComplexObject.current, complexObject);
  if (diff.hasChanges) {
    updateComponent();
    prevComplexObject.current = complexObject;
  }
}, [complexObject]);
```

### 3. Use Garbage Collection for Cached Data

```typescript
// ❌ Bad - memory leak with unbounded cache
const cache = new Map();

// ✅ Good - automatic cleanup
const cache = new StateGarbageCollector({ maxSize: 50, maxAge: 300000 });
```

### 4. Monitor Performance in Development

```typescript
// ✅ Enable performance monitoring in development
const MyComponent = process.env.NODE_ENV === 'development' 
  ? withPerformanceMonitoring(MyComponentImpl, 'MyComponent')
  : MyComponentImpl;
```

## Memory Usage Guidelines

1. **Clean up subscriptions** - Always call unsubscribe functions
2. **Use weak references** - For objects that should be garbage collected
3. **Implement cleanup effects** - Use useEffect cleanup functions
4. **Monitor memory usage** - Use performance monitoring tools
5. **Avoid circular references** - Be careful with object references

## Performance Tips

1. **Memoize expensive computations** - Use useOptimizedMemo for heavy calculations
2. **Split large components** - Break down into smaller, focused components
3. **Use stable callbacks** - Prevent unnecessary re-renders from function recreation
4. **Implement virtual scrolling** - For large lists
5. **Debounce frequent updates** - Batch rapid state changes

## Integration with Existing Code

These optimizations can be gradually integrated into existing codebases:

```typescript
// Step 1: Start with performance monitoring
import { globalPerformanceMonitor } from '@oxyhq/services';

// Step 2: Add selective subscriptions for heavy components
import { useOxySelector } from '@oxyhq/services';

// Step 3: Implement memoization for expensive operations
import { useOptimizedMemo } from '@oxyhq/services';

// Step 4: Add garbage collection for cached data
import { StateGarbageCollector } from '@oxyhq/services';
```

The optimizations are designed to be non-breaking and can be adopted incrementally based on your application's needs.