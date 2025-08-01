/**
 * Example demonstrating the TypeError fix for search functionality
 * 
 * This example shows how the new service guards prevent the original error:
 * "TypeError: Cannot read properties of undefined (reading 'searchProfiles')"
 */

import { OxyServices } from './packages/services/src/core';
import { safeSearchProfiles, safeHandleSearch, isServiceReady } from './packages/services/src/utils/serviceGuards';

// Example 1: Direct safe search (prevents TypeError)
async function exampleDirectSearch() {
  let oxyServices: OxyServices | null = null; // Simulating undefined service

  console.log('=== Example 1: Direct Safe Search ===');
  
  // OLD WAY (would cause TypeError):
  // const results = await oxyServices.searchProfiles('test'); 
  // ❌ TypeError: Cannot read properties of undefined (reading 'searchProfiles')
  
  // NEW WAY (safe, returns empty array):
  const results = await safeSearchProfiles(oxyServices, 'test');
  console.log('Results with undefined service:', results); // []
  
  // When service becomes available
  oxyServices = new OxyServices({ baseURL: 'https://api.example.com' });
  const realResults = await safeSearchProfiles(oxyServices, 'test');
  console.log('Results with valid service:', realResults); // API response or []
}

// Example 2: Using safeHandleSearch for UI pattern
async function exampleHandleSearch() {
  let oxyServices: OxyServices | null = null; // Simulating undefined service

  console.log('\n=== Example 2: Safe Handle Search Pattern ===');
  
  await safeHandleSearch(oxyServices, 'test query', {
    onSuccess: (results) => {
      console.log('Search successful, got results:', results.length);
    },
    onError: (error) => {
      console.log('Search failed:', error.message);
    },
    onEmpty: () => {
      console.log('No results found or service not ready');
    }
  });
}

// Example 3: Service readiness check
function exampleServiceReadiness() {
  console.log('\n=== Example 3: Service Readiness Check ===');
  
  let oxyServices: OxyServices | null = null;
  
  console.log('Service ready (null):', isServiceReady(oxyServices)); // false
  
  oxyServices = new OxyServices({ baseURL: 'https://api.example.com' });
  console.log('Service ready (initialized):', isServiceReady(oxyServices)); // true
  
  const incompleteService = { searchProfiles: () => {} }; // Missing other methods
  console.log('Service ready (incomplete):', isServiceReady(incompleteService as any)); // false
}

// Example 4: React-like usage pattern (pseudo-code)
function exampleReactUsage() {
  console.log('\n=== Example 4: React Hook Pattern ===');
  
  // Pseudo-code for React component
  console.log(`
  // Before fix - could cause crashes:
  const MySearchComponent = () => {
    const { oxyServices } = useOxy(); // Could be undefined
    
    const handleSearch = async (query) => {
      const results = await oxyServices.searchProfiles(query); // ❌ TypeError risk
      setResults(results);
    };
  };
  
  // After fix - safe and robust:
  const MySearchComponent = () => {
    const { results, search, isLoading, error } = useSearch(); // ✅ Safe hook
    
    const handleSearch = (query) => {
      search(query); // ✅ No TypeError possible
    };
    
    // Component handles all states gracefully
    if (!isServiceReady) return <Text>Loading...</Text>;
    if (error) return <Text>Error: {error}</Text>;
    if (isLoading) return <ActivityIndicator />;
    
    return (
      <FlatList
        data={results}
        renderItem={({ item }) => <UserItem user={item} />}
      />
    );
  };
  `);
}

// Run examples
async function runExamples() {
  try {
    await exampleDirectSearch();
    await exampleHandleSearch();
    exampleServiceReadiness();
    exampleReactUsage();
    
    console.log('\n✅ All examples completed without TypeError!');
  } catch (error) {
    console.error('❌ Example failed:', error);
  }
}

// Export for potential testing
export {
  exampleDirectSearch,
  exampleHandleSearch,
  exampleServiceReadiness,
  runExamples
};

// If running directly (not as module)
if (typeof require !== 'undefined' && require.main === module) {
  runExamples();
}