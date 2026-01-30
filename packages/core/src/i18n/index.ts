// Use JSON locale files (RN Metro supports static requires reliably)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const enUS = require('./locales/en-US.json') as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const esES = require('./locales/es-ES.json') as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const caES = require('./locales/ca-ES.json') as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const frFR = require('./locales/fr-FR.json') as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const deDE = require('./locales/de-DE.json') as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const itIT = require('./locales/it-IT.json') as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ptPT = require('./locales/pt-PT.json') as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jaJP = require('./locales/ja-JP.json') as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const koKR = require('./locales/ko-KR.json') as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const zhCN = require('./locales/zh-CN.json') as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const arSA = require('./locales/ar-SA.json') as Record<string, any>;

export type LocaleDict = Record<string, any>;

const DICTS: Record<string, LocaleDict> = {
  'en': enUS as LocaleDict,
  'en-US': enUS as LocaleDict,
  'es': esES as LocaleDict,
  'es-ES': esES as LocaleDict,
  'ca': caES as LocaleDict,
  'ca-ES': caES as LocaleDict,
  'fr': frFR as LocaleDict,
  'fr-FR': frFR as LocaleDict,
  'de': deDE as LocaleDict,
  'de-DE': deDE as LocaleDict,
  'it': itIT as LocaleDict,
  'it-IT': itIT as LocaleDict,
  'pt': ptPT as LocaleDict,
  'pt-PT': ptPT as LocaleDict,
  'ja': jaJP as LocaleDict,
  'ja-JP': jaJP as LocaleDict,
  'ko': koKR as LocaleDict,
  'ko-KR': koKR as LocaleDict,
  'zh': zhCN as LocaleDict,
  'zh-CN': zhCN as LocaleDict,
  'ar': arSA as LocaleDict,
  'ar-SA': arSA as LocaleDict,
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
