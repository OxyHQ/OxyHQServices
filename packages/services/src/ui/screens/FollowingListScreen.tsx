import React from 'react';
import type { BaseScreenProps } from '../types/navigation';
import UserListScreen from './UserListScreen';

interface FollowingListScreenProps extends BaseScreenProps {
  userId: string;
  initialCount?: number;
}

const FollowingListScreen: React.FC<FollowingListScreenProps> = (props) => {
  return <UserListScreen {...props} mode="following" />;
};

export default FollowingListScreen;
