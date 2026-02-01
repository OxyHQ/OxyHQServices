import enUS from './locales/en-US.json';
import esES from './locales/es-ES.json';
import caES from './locales/ca-ES.json';
import frFR from './locales/fr-FR.json';
import deDE from './locales/de-DE.json';
import itIT from './locales/it-IT.json';
import ptPT from './locales/pt-PT.json';
import jaJP from './locales/ja-JP.json';
import koKR from './locales/ko-KR.json';
import zhCN from './locales/zh-CN.json';
import arSA from './locales/ar-SA.json';

export type LocaleDict = Record<string, any>;

const DICTS: Record<string, LocaleDict> = {
  'en': enUS,
  'en-US': enUS,
  'es': esES,
  'es-ES': esES,
  'ca': caES,
  'ca-ES': caES,
  'fr': frFR,
  'fr-FR': frFR,
  'de': deDE,
  'de-DE': deDE,
  'it': itIT,
  'it-IT': itIT,
  'pt': ptPT,
  'pt-PT': ptPT,
  'ja': jaJP,
  'ja-JP': jaJP,
  'ko': koKR,
  'ko-KR': koKR,
  'zh': zhCN,
  'zh-CN': zhCN,
  'ar': arSA,
  'ar-SA': arSA,
};

const FALLBACK = 'en-US';

function getNested(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc && acc[key] != null ? acc[key] : undefined), obj);
}

export function translate(locale: string | undefined, key: string, vars?: Record<string, string | number>): string {
  const lang = locale && DICTS[locale] ? locale : FALLBACK;
  const dict = DICTS[lang] || DICTS[FALLBACK];
  let val = getNested(dict, key);
  if (typeof val !== 'string') return key; // fallback to key if missing
  if (vars) {
    Object.keys(vars).forEach(k => {
      const token = `{{${k}}}`;
      val = val.replaceAll(token, String(vars[k]));
    });
  }
  return val;
}

export function hasKey(locale: string | undefined, key: string): boolean {
  const lang = locale && DICTS[locale] ? locale : FALLBACK;
  return getNested(DICTS[lang], key) != null || getNested(DICTS[FALLBACK], key) != null;
}
