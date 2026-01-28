import React from 'react';
import type { BaseScreenProps } from '../types/navigation';
import UserListScreen from './UserListScreen';

interface FollowersListScreenProps extends BaseScreenProps {
  userId: string;
  initialCount?: number;
}

const FollowersListScreen: React.FC<FollowersListScreenProps> = (props) => {
  return <UserListScreen {...props} mode="followers" />;
};

export default FollowersListScreen;
