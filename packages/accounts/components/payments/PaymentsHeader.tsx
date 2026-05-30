import React from 'react';
import { ScreenHeader } from '@/components/ui';
import { useTranslation } from '@/lib/i18n';

/**
 * Localized screen header for the Payments screen. Wraps the shared
 * {@link ScreenHeader} (which already adapts its type scale for desktop vs.
 * mobile) so the title/subtitle copy lives in one place.
 */
export function PaymentsHeader() {
  const { t } = useTranslation();
  return <ScreenHeader title={t('payments.title')} subtitle={t('payments.subtitle')} />;
}
