import { NativeTabs, Icon, Label, VectorIcon } from 'expo-router/unstable-native-tabs';
import { Slot } from 'expo-router';
import { Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';

export default function TabLayout() {
  if (Platform.OS === 'web') {
    return <Slot />;
  }

  return (
    <NativeTabs minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <Label>Home</Label>
        {Platform.select({
          ios: <Icon sf="house.fill" />,
          android: <Icon src={<VectorIcon family={MaterialCommunityIcons} name="home-variant" />} />,
        })}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="personal-info">
        {Platform.select({
          ios: <Icon sf="person.fill" />,
          android: <Icon src={<VectorIcon family={MaterialCommunityIcons} name="card-account-details-outline" />} />,
        })}
        <Label>Personal</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="security">
        {Platform.select({
          ios: <Icon sf="lock.fill" />,
          android: <Icon src={<VectorIcon family={MaterialCommunityIcons} name="lock-outline" />} />,
        })}
        <Label>Security</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

