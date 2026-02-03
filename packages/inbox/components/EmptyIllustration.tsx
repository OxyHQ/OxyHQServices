import React from 'react';
import { Image } from 'expo-image';

export function EmptyIllustration({ size = 200 }: { size?: number }) {
  return (
    <Image
      source={require('@/assets/images/illustrations/empty.svg')}
      style={{ width: size, height: size }}
      contentFit="contain"
    />
  );
}
