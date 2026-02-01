/**
 * Tests for isDev() utility.
 *
 * These tests manipulate the global __DEV__ and process.env.NODE_ENV
 * to verify isDev() works across RN, Node, and browser-like environments.
 */

describe('isDev', () => {
  const originalDev = (globalThis as any).__DEV__;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    // Restore globals
    if (originalDev === undefined) {
      delete (globalThis as any).__DEV__;
    } else {
      (globalThis as any).__DEV__ = originalDev;
    }
    process.env.NODE_ENV = originalNodeEnv;

    // Clear module cache so isDev re-evaluates
    jest.resetModules();
  });

  async function loadIsDev() {
    const mod = await import('../debugUtils');
    return mod.isDev;
  }

  it('returns true when __DEV__ is true (React Native)', async () => {
    (globalThis as any).__DEV__ = true;
    const isDev = await loadIsDev();
    expect(isDev()).toBe(true);
  });

  it('returns false when __DEV__ is false', async () => {
    (globalThis as any).__DEV__ = false;
    const isDev = await loadIsDev();
    expect(isDev()).toBe(false);
  });

  it('falls back to NODE_ENV when __DEV__ is undefined', async () => {
    delete (globalThis as any).__DEV__;
    process.env.NODE_ENV = 'development';
    const isDev = await loadIsDev();
    expect(isDev()).toBe(true);
  });

  it('returns false when NODE_ENV is production and __DEV__ is undefined', async () => {
    delete (globalThis as any).__DEV__;
    process.env.NODE_ENV = 'production';
    const isDev = await loadIsDev();
    expect(isDev()).toBe(false);
  });
});
