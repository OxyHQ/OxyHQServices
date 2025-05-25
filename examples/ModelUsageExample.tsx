import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';

// Import both the services class and type models
import { 
  OxyServices, 
  Models,           // Namespace import of all models
  User,             // Direct import of specific model
  FollowButton
} from '@oxyhq/services';

/**
 * Example showing how to use Oxy models and components together
 */
const ModelUsageExample = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [recommendations, setRecommendations] = useState<Models.User[]>([]);
  
  // Initialize OxyServices (in a real app, you would do this in your app's entry point)
  const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });
  
  useEffect(() => {
    // Example of using models with the API
    const fetchData = async () => {
      try {
        // This call returns data conforming to the User interface
        const searchResults = await oxyServices.searchProfiles('john', 10, 0);
        setUsers(searchResults);
        
        // This call returns data with the profile recommendation interface
        const recommendedProfiles = await oxyServices.getProfileRecommendations();
        setRecommendations(recommendedProfiles);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      }
    };
    
    fetchData();
  }, []);
  
  const renderUserItem = ({ item }: { item: User }) => (
    <View style={styles.userCard}>
      <View>
        <Text style={styles.userName}>{item.name?.full || item.username}</Text>
        {item.bio && <Text style={styles.userBio}>{item.bio}</Text>}
      </View>
      
      {/* Using the FollowButton component with the User model */}
      <FollowButton 
        userId={item.id}
        size="small"
      />
    </View>
  );
  
  const renderRecommendedItem = ({ item }: { item: Models.User }) => (
    <View style={styles.recommendedCard}>
      <View>
        <Text style={styles.recommendedName}>
          {item.name?.full || item.username}
        </Text>
        <Text style={styles.followerCount}>
          {item._count?.followers || 0} followers
        </Text>
      </View>
      
      {/* Using the FollowButton component with a recommended profile */}
      <FollowButton 
        userId={item.id} 
        size="small"
      />
    </View>
  );
  
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Search Results</Text>
      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        renderItem={renderUserItem}
        contentContainerStyle={styles.listContainer}
      />
      
      <Text style={styles.header}>Recommended Profiles</Text>
      <FlatList
        data={recommendations}
        keyExtractor={(item) => item.id}
        renderItem={renderRecommendedItem}
        contentContainerStyle={styles.listContainer}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  header: {
    fontSize: 20,
    fontWeight: 'bold',
    marginVertical: 16,
  },
  listContainer: {
    paddingBottom: 16,
  },
  userCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8F8F8',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
  },
  userBio: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  recommendedCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F0F0FF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#d169e5',
  },
  recommendedName: {
    fontSize: 16,
    fontWeight: '600',
  },
  followerCount: {
    fontSize: 14,
    color: '#666',
  },
});

export default ModelUsageExample;