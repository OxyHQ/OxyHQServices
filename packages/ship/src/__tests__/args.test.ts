import { test, expect, describe } from 'bun:test';
import {
  parseArgs,
  platformsFlag,
  rolloutFlag,
  stringFlag,
  requireString,
  baseUrlFlag,
} from '../args';

describe('parseArgs', () => {
  test('splits command, flag values, = form, and booleans', () => {
    const parsed = parseArgs([
      'publish',
      '--channel',
      'production',
      '--rollout=50',
      '--dry-run',
      '--message',
      'hello world',
    ]);
    expect(parsed.command).toBe('publish');
    expect(parsed.flags.channel).toBe('production');
    expect(parsed.flags.rollout).toBe('50');
    expect(parsed.flags['dry-run']).toBe(true);
    expect(parsed.flags.message).toBe('hello world');
  });

  test('a boolean flag becomes true and the subcommand is the positional', () => {
    const parsed = parseArgs(['channel:list', '--json']);
    expect(parsed.command).toBe('channel:list');
    expect(parsed.flags.json).toBe(true);
  });

  test('an unknown flag is rejected (strict)', () => {
    expect(() => parseArgs(['publish', '--bogus', 'x'])).toThrow();
  });
});

describe('flag helpers', () => {
  test('platformsFlag defaults to both and validates', () => {
    expect(platformsFlag({})).toEqual(['ios', 'android']);
    expect(platformsFlag({ platform: 'all' })).toEqual(['ios', 'android']);
    expect(platformsFlag({ platform: 'ios' })).toEqual(['ios']);
    expect(() => platformsFlag({ platform: 'windows' })).toThrow();
  });

  test('rolloutFlag parses + range-checks', () => {
    expect(rolloutFlag({})).toBeUndefined();
    expect(rolloutFlag({ rollout: '0' })).toBe(0);
    expect(rolloutFlag({ rollout: '100' })).toBe(100);
    expect(() => rolloutFlag({ rollout: '150' })).toThrow();
    expect(() => rolloutFlag({ rollout: 'abc' })).toThrow();
  });

  test('stringFlag prefers the flag, then env, then default', () => {
    process.env.SHIP_TEST_VAR = 'from-env';
    expect(stringFlag({ x: 'from-flag' }, 'x', 'SHIP_TEST_VAR', 'def')).toBe('from-flag');
    expect(stringFlag({}, 'x', 'SHIP_TEST_VAR', 'def')).toBe('from-env');
    delete process.env.SHIP_TEST_VAR;
    expect(stringFlag({}, 'x', 'SHIP_TEST_VAR', 'def')).toBe('def');
  });

  test('requireString throws when neither flag nor env is set', () => {
    expect(() => requireString({}, 'client-id', 'OXY_SHIP_CLIENT_ID_MISSING')).toThrow(/client-id/);
  });

  test('baseUrlFlag prefers --url, then --api-url/OXY_API_URL, then the default', () => {
    expect(baseUrlFlag({ url: 'http://a' })).toBe('http://a');
    expect(baseUrlFlag({ 'api-url': 'http://b' })).toBe('http://b');
    expect(baseUrlFlag({})).toBe('https://api.oxy.so');
  });
});
