import fs from 'node:fs';
import path from 'node:path';
import { SUPPORTED_LOCALES } from '@/lib/i18n/types';

const LOCALES_DIR = path.resolve(__dirname, '../../lib/i18n/locales');

type Dict = Record<string, unknown>;

/** Recursively collect every dot-separated leaf key path in a JSON dict. */
function collectKeys(node: unknown, prefix = ''): string[] {
  if (node == null) return [];
  if (typeof node !== 'object') return [prefix];
  if (Array.isArray(node)) {
    return node.flatMap((child, idx) => collectKeys(child, prefix ? `${prefix}.${idx}` : `${idx}`));
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    collectKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

/** Recursively gather every leaf string value in a JSON dict. */
function collectStringValues(node: unknown): string[] {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  if (typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(collectStringValues);
  return Object.values(node as Record<string, unknown>).flatMap(collectStringValues);
}

function loadLocale(file: string): Dict {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8');
  return JSON.parse(raw) as Dict;
}

describe('accounts locale files', () => {
  it('contains en.json and es.json', () => {
    expect(fs.existsSync(path.join(LOCALES_DIR, 'en.json'))).toBe(true);
    expect(fs.existsSync(path.join(LOCALES_DIR, 'es.json'))).toBe(true);
  });

  it('en.json parses as valid JSON', () => {
    expect(() => loadLocale('en.json')).not.toThrow();
  });

  it('es.json parses as valid JSON', () => {
    expect(() => loadLocale('es.json')).not.toThrow();
  });

  it('en.json has at least one top-level namespace', () => {
    const en = loadLocale('en.json');
    expect(Object.keys(en).length).toBeGreaterThan(0);
  });

  it('every key in en.json also exists in es.json', () => {
    const en = loadLocale('en.json');
    const es = loadLocale('es.json');
    const enKeys = collectKeys(en).sort();
    const esKeys = new Set(collectKeys(es));
    const missing = enKeys.filter((key) => !esKeys.has(key));
    expect(missing).toEqual([]);
  });

  it('every key in es.json also exists in en.json (no orphan translations)', () => {
    const en = loadLocale('en.json');
    const es = loadLocale('es.json');
    const esKeys = collectKeys(es).sort();
    const enKeys = new Set(collectKeys(en));
    const orphans = esKeys.filter((key) => !enKeys.has(key));
    expect(orphans).toEqual([]);
  });

  it('en.json contains no empty string values', () => {
    const en = loadLocale('en.json');
    const empty = collectStringValues(en).filter((s) => s.length === 0);
    expect(empty).toEqual([]);
  });

  it('es.json contains no empty string values', () => {
    const es = loadLocale('es.json');
    const empty = collectStringValues(es).filter((s) => s.length === 0);
    expect(empty).toEqual([]);
  });
});

describe('SUPPORTED_LOCALES', () => {
  it('includes en-US', () => {
    expect(SUPPORTED_LOCALES).toContain('en-US');
  });

  it('includes es-ES', () => {
    expect(SUPPORTED_LOCALES).toContain('es-ES');
  });

  it('contains no duplicates', () => {
    const set = new Set(SUPPORTED_LOCALES);
    expect(set.size).toBe(SUPPORTED_LOCALES.length);
  });

  it('every entry follows BCP-47 language-REGION form', () => {
    const tagPattern = /^[a-z]{2,3}-[A-Z]{2}$/;
    for (const locale of SUPPORTED_LOCALES) {
      expect(locale).toMatch(tagPattern);
    }
  });
});
