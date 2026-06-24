import { Slot } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { TabBar } from '@/components/tab-bar';

export default function TabLayout() {
  return (
    <View style={styles.container}>
      <Slot />
      <TabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
