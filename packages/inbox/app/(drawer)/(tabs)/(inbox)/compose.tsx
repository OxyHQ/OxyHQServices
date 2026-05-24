import { Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';

import { ComposeForm } from '@/components/ComposeForm';
import { useTranslation } from '@/lib/i18n';

export default function ComposeRoute() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    replyTo?: string;
    forward?: string;
    to?: string;
    cc?: string;
    toName?: string;
    subject?: string;
    body?: string;
  }>();

  const pageTitle = params.subject
    ? t('compose.headTitleWithSubject', { subject: params.subject })
    : t('compose.headTitleCompose');

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
      </Head>
      <ComposeForm
        mode={isDesktop ? 'embedded' : 'standalone'}
        replyTo={params.replyTo}
        forward={params.forward}
        to={params.to}
        cc={params.cc}
        subject={params.subject}
        body={params.body}
      />
    </>
  );
}
