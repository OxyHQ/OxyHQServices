import { useMemo } from 'react';
import { useOxy } from '../context/OxyContext';
import { translate } from '../../i18n';

export function useI18n() {
  const { currentLanguage } = useOxy();
  const t = useMemo(() => {
    return (key: string, vars?: Record<string, string | number>) => translate(currentLanguage, key, vars);
  }, [currentLanguage]);
  return { t, locale: currentLanguage };
}

