import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  SafeAreaView, 
  Image, 
  ScrollView, 
  TouchableOpacity,
  ImageBackground 
} from 'react-native';
import { OxyProvider, FollowButton, Avatar } from '@oxyhq/services';

// Mock data for the social profile
const mockProfileData = {
  userId: '1234567',
  username: 'sarah_designs',
  displayName: 'Sarah Johnson',
  bio: 'Product designer & 3D artist | Creating interfaces that spark joy ✨ | Sharing UI/UX tips and experiences',
  followers: 1248,
  following: 356,
  posts: 42,
  isVerified: true,
};

/**
 * Example showing a social profile screen with the FollowButton implementation
 */
const SocialProfileExample = () => {
  const [followersCount, setFollowersCount] = useState(mockProfileData.followers);
  const [isFollowing, setIsFollowing] = useState(false);
  
  // Handle follow state changes
  const handleFollowChange = (following: boolean) => {
    console.log(`User is now ${following ? 'followed' : 'unfollowed'}`);
    
    // Update followers count
    setFollowersCount(prev => following ? prev + 1 : prev - 1);
    setIsFollowing(following);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {/* Cover Image */}
        <ImageBackground 
          source={{ uri: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?fit=crop&w=800&q=80' }} 
          style={styles.coverImage}
        >
          <View style={styles.overlay} />
        </ImageBackground>
        
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.profileImageContainer}>
            <Avatar 
              size={90} 
              name={mockProfileData.displayName}
              source={{ uri: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?fit=crop&w=400&q=80' }}
            />
            {mockProfileData.isVerified && (
              <View style={styles.verifiedBadge}>
                <Text style={styles.verifiedIcon}>✓</Text>
              </View>
            )}
          </View>
          
          <View style={styles.profileInfo}>
            <Text style={styles.displayName}>{mockProfileData.displayName}</Text>
            <Text style={styles.username}>@{mockProfileData.username}</Text>
            <Text style={styles.bio}>{mockProfileData.bio}</Text>
          </View>
          
          <View style={styles.actions}>
            <FollowButton 
              userId={mockProfileData.userId}
              initiallyFollowing={isFollowing}
              size="medium"
              onFollowChange={handleFollowChange}
            />
            
            <TouchableOpacity style={styles.messageButton}>
              <Text style={styles.messageButtonText}>Message</Text>
            </TouchableOpacity>
          </View>
          
          {/* Stats */}
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{mockProfileData.posts}</Text>
              <Text style={styles.statLabel}>Posts</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{followersCount}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{mockProfileData.following}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </View>
          </View>
        </View>
        
        {/* Content Tabs */}
        <View style={styles.tabsContainer}>
          <TouchableOpacity style={[styles.tab, styles.activeTab]}>
            <Text style={[styles.tabText, styles.activeTabText]}>Posts</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tab}>
            <Text style={styles.tabText}>About</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tab}>
            <Text style={styles.tabText}>Media</Text>
          </TouchableOpacity>
        </View>
        
        {/* Content Grid */}
        <View style={styles.contentGrid}>
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <View key={item} style={styles.gridItem}>
              <View style={styles.postPlaceholder} />
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  coverImage: {
    height: 200,
    width: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  profileHeader: {
    padding: 16,
    marginTop: -40,
  },
  profileImageContainer: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    backgroundColor: '#d169e5',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  verifiedIcon: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  profileInfo: {
    marginBottom: 16,
  },
  displayName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  username: {
    fontSize: 16,
    color: '#666666',
    marginBottom: 8,
  },
  bio: {
    fontSize: 16,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  messageButton: {
    marginLeft: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d169e5',
    backgroundColor: 'transparent',
  },
  messageButtonText: {
    color: '#d169e5',
    fontWeight: '600',
    fontSize: 14,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#F0F0F0',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#666666',
  },
  statDivider: {
    width: 1,
    backgroundColor: '#F0F0F0',
  },
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#F0F0F0',
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderColor: '#d169e5',
  },
  tabText: {
    fontSize: 16,
    color: '#666666',
  },
  activeTabText: {
    fontWeight: '600',
    color: '#d169e5',
  },
  contentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 4,
  },
  gridItem: {
    width: '33.33%',
    padding: 4,
  },
  postPlaceholder: {
    aspectRatio: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
  },
});

export default SocialProfileExample;