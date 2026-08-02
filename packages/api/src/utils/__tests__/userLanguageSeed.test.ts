/**
 * Pure locale-resolution logic for the `seed-user-languages` migration.
 */

import { resolveSeedLocale } from '../userLanguageSeed';

describe('resolveSeedLocale', () => {
  it('keeps an already-valid locale (canonicalized)', () => {
    expect(resolveSeedLocale('es-ES')).toBe('es-ES');
    expect(resolveSeedLocale('EN-us')).toBe('en-US');
  });

  it('upgrades a bare base code to that language\'s default locale', () => {
    expect(resolveSeedLocale('es')).toBe('es-ES');
    expect(resolveSeedLocale('en')).toBe('en-US');
    expect(resolveSeedLocale('pt')).toBe('pt-BR');
    expect(resolveSeedLocale('fr')).toBe('fr-FR');
  });

  it('falls back to en-US for missing, empty or unresolvable input', () => {
    expect(resolveSeedLocale(undefined)).toBe('en-US');
    expect(resolveSeedLocale('')).toBe('en-US');
    expect(resolveSeedLocale('   ')).toBe('en-US');
    expect(resolveSeedLocale(42)).toBe('en-US');
    expect(resolveSeedLocale('xx')).toBe('en-US');
    expect(resolveSeedLocale('zz-ZZ')).toBe('en-US');
  });
});
