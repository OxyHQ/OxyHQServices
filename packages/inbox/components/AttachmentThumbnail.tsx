/**
 * Small image thumbnail for attachment previews in message rows.
 * Fetches a presigned S3 URL and renders a cached image.
 */

import React, { useState } from 'react';
import { View, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useAttachmentUrl } from '@/hooks/queries/useAttachmentUrl';
import { useColors } from '@/constants/theme';

interface AttachmentThumbnailProps {
  s3Key: string;
  size?: number;
}

export function AttachmentThumbnail({ s3Key, size = 48 }: AttachmentThumbnailProps) {
  const colors = useColors();
  const { url, isLoading } = useAttachmentUrl(s3Key);
  const [errored, setErrored] = useState(false);

  const containerStyle = [
    styles.container,
    { width: size, height: size, backgroundColor: colors.surfaceVariant },
  ];

  if (isLoading) {
    return (
      <View style={containerStyle}>
        <ActivityIndicator size="small" color={colors.secondaryText} />
      </View>
    );
  }

  if (!url || errored) {
    return (
      <View style={containerStyle}>
        <MaterialCommunityIcons name="image-broken-variant" size={18} color={colors.secondaryText} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: url }}
      style={[containerStyle, styles.image]}
      onError={() => setErrored(true)}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    resizeMode: 'cover',
  },
});
