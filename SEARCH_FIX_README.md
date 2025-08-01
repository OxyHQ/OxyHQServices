# TypeError Fix: Search Functionality

This document describes the fix for the TypeError "Cannot read properties of undefined (reading 'searchProfiles')" and provides guidance on preventing similar issues.

## Problem

The error occurred when UI components tried to access the `searchProfiles` method on an undefined `oxyServices` instance. This typically happens when:

1. The service context is not properly initialized
2. Components try to access the service before it's ready
3. The service instance becomes null/undefined during runtime

## Solution

We've implemented several defensive measures to prevent this TypeError:

### 1. Service Guard Utilities (`utils/serviceGuards.ts`)

New utility functions that safely handle service method calls:

- `safeSearchProfiles()` - Safe wrapper for searchProfiles method
- `safeServiceCall()` - Generic safe wrapper for any service method
- `isServiceReady()` - Check if service instance is ready
- `safeHandleSearch()` - Safe wrapper for search operations
- `safeLoadMoreResults()` - Safe wrapper for pagination
- `waitForServiceReady()` - Wait for service to become ready

### 2. Safe Context Hook (`useSafeOxy`)

A new hook that returns `null` instead of throwing an error when the service is not available:

```typescript
const oxyContext = useSafeOxy(); // Returns null if service not ready
if (oxyContext?.oxyServices) {
  // Safe to use the service
}
```

### 3. Search Hook (`useSearch`)

A comprehensive hook that provides safe search functionality:

```typescript
const {
  results,
  isLoading,
  error,
  search,
  loadMore,
  clearSearch,
  isServiceReady
} = useSearch({
  pageSize: 10,
  onError: (error) => console.error('Search failed:', error),
  onSuccess: (results) => console.log('Search results:', results)
});

// Safe to call even if service is not ready
search('my query');
```

## Usage Examples

### Before (Unsafe)

```typescript
// This could cause TypeError if oxyServices is undefined
const handleSearch = async (query: string) => {
  const results = await oxyServices.searchProfiles(query);
  setResults(results);
};
```

### After (Safe)

```typescript
import { safeSearchProfiles } from '@oxyhq/services/utils';

const handleSearch = async (query: string) => {
  const results = await safeSearchProfiles(oxyServices, query);
  setResults(results); // Always returns array, never undefined
};
```

### Using the Search Hook

```typescript
import { useSearch } from '@oxyhq/services/ui';

const SearchComponent = () => {
  const { results, isLoading, search, error, isServiceReady } = useSearch();

  if (!isServiceReady) {
    return <Text>Search service is loading...</Text>;
  }

  return (
    <View>
      <TextInput
        onChangeText={(text) => search(text)}
        placeholder="Search users..."
      />
      {isLoading && <ActivityIndicator />}
      {error && <Text>Error: {error}</Text>}
      {results.map(user => (
        <UserItem key={user.id} user={user} />
      ))}
    </View>
  );
};
```

### VirtualizedList Integration

```typescript
import { useSearch } from '@oxyhq/services/ui';

const SearchList = () => {
  const { results, isLoading, loadMore, hasMore } = useSearch({ pageSize: 20 });

  const handleEndReached = () => {
    if (hasMore && !isLoading) {
      loadMore();
    }
  };

  return (
    <VirtualizedList
      data={results}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.5}
      // ... other props
    />
  );
};
```

## Best Practices

1. **Always use safe hooks**: Prefer `useSafeOxy()` over `useOxy()` when the service might not be ready
2. **Check service readiness**: Use `isServiceReady()` before making service calls
3. **Use the search hook**: For search functionality, use `useSearch()` hook instead of direct service calls
4. **Handle loading states**: Always show appropriate loading/error states to users
5. **Validate inputs**: Always validate search queries and parameters before making calls

## Migration Guide

If you have existing code that directly calls `searchProfiles`:

1. **Replace direct calls** with safe wrappers:
   ```diff
   - const results = await oxyServices.searchProfiles(query);
   + const results = await safeSearchProfiles(oxyServices, query);
   ```

2. **Use the search hook** for React components:
   ```diff
   - const [results, setResults] = useState([]);
   - const handleSearch = async (query) => {
   -   const results = await oxyServices.searchProfiles(query);
   -   setResults(results);
   - };
   + const { results, search } = useSearch();
   + const handleSearch = (query) => search(query);
   ```

3. **Add service readiness checks**:
   ```diff
   + if (!isServiceReady(oxyServices)) {
   +   // Handle service not ready state
   +   return;
   + }
   ```

## Testing

All new utilities include comprehensive tests. Run the test suite:

```bash
npm test serviceGuards
npm test useSearch
```

## Error Prevention

These changes prevent the following error scenarios:

- ✅ Service instance is null/undefined
- ✅ Service method doesn't exist
- ✅ Service call fails (returns empty array instead of crashing)
- ✅ Component unmounted during async operation
- ✅ Multiple concurrent search operations
- ✅ Invalid search parameters

The fix ensures that UI components never crash due to service unavailability while providing appropriate feedback to users.