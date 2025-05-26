import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { OxyProvider, FollowButton } from '@oxyhq/services/ui';

/**
 * Example component demonstrating the usage of the FollowButton component
 */
const FollowButtonExample = () => {
  const [followingCount, setFollowingCount] = useState(0);
  const [followersCount, setFollowersCount] = useState(148);
  
  // Handle follow state changes
  const handleFollowChange = (isFollowing: boolean) => {
    console.log(`User is now ${isFollowing ? 'followed' : 'unfollowed'}`);
    
    // Update following/followers count for demo purposes
    if (isFollowing) {
      setFollowingCount(prev => prev + 1);
      setFollowersCount(prev => prev + 1);
    } else {
      setFollowingCount(prev => Math.max(0, prev - 1));
      setFollowersCount(prev => Math.max(0, prev - 1));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>FollowButton Examples</Text>
        <Text style={styles.subtitle}>Animated UI component for social interactions</Text>
      </View>

      <View style={styles.userProfileCard}>
        <View style={styles.userInfo}>
          <View style={styles.avatar} />
          <View>
            <Text style={styles.username}>@johndoe</Text>
            <Text style={styles.stats}>
              {followingCount} Following • {followersCount} Followers
            </Text>
          </View>
        </View>
        
        <FollowButton 
          userId="123"
          onFollowChange={handleFollowChange}
        />
      </View>

      <View style={styles.sizeDemoSection}>
        <Text style={styles.sectionTitle}>Button Size Variants</Text>
        
        <View style={styles.buttonRow}>
          <View style={styles.buttonExample}>
            <Text style={styles.buttonLabel}>Small</Text>
            <FollowButton userId="101" size="small" />
          </View>
          
          <View style={styles.buttonExample}>
            <Text style={styles.buttonLabel}>Medium (default)</Text>
            <FollowButton userId="102" />
          </View>
          
          <View style={styles.buttonExample}>
            <Text style={styles.buttonLabel}>Large</Text>
            <FollowButton userId="103" size="large" />
          </View>
        </View>
      </View>

      <View style={styles.stateDemoSection}>
        <Text style={styles.sectionTitle}>States & Options</Text>
        
        <View style={styles.buttonRow}>
          <View style={styles.buttonExample}>
            <Text style={styles.buttonLabel}>Following</Text>
            <FollowButton 
              userId="201" 
              initiallyFollowing={true}
            />
          </View>
          
          <View style={styles.buttonExample}>
            <Text style={styles.buttonLabel}>Not Following</Text>
            <FollowButton 
              userId="202" 
              initiallyFollowing={false}
            />
          </View>

          <View style={styles.buttonExample}>
            <Text style={styles.buttonLabel}>Disabled</Text>
            <FollowButton 
              userId="203" 
              disabled={true}
            />
          </View>
          
          <View style={styles.buttonExample}>
            <Text style={styles.buttonLabel}>No Loading State</Text>
            <FollowButton 
              userId="204" 
              showLoadingState={false}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f8f8f8',
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  userProfileCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#d169e5',
    marginRight: 12,
  },
  username: {
    fontSize: 18,
    fontWeight: '600',
  },
  stats: {
    color: '#666',
    marginTop: 4,
  },
  sizeDemoSection: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  stateDemoSection: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  buttonExample: {
    alignItems: 'center',
    marginBottom: 16,
    minWidth: '30%',
  },
  buttonLabel: {
    marginBottom: 8,
    color: '#666',
  },
});

export default FollowButtonExample;