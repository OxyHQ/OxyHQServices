import { Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { ComposeForm } from '@/components/ComposeForm';

export default function ComposeRoute() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;
  const params = useLocalSearchParams<{
    replyTo?: string;
    forward?: string;
    to?: string;
    toName?: string;
    subject?: string;
    body?: string;
  }>();

  return (
    <ComposeForm
      mode={isDesktop ? 'embedded' : 'standalone'}
      replyTo={params.replyTo}
      forward={params.forward}
      to={params.to}
      toName={params.toName}
      subject={params.subject}
      body={params.body}
    />
  );
}
