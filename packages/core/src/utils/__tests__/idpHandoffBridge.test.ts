import {
  buildIdpBridgeUrl,
  buildIdpHandoffEmbedUrl,
  buildIdpHubOrigin,
  isAllowedBridgeParentOrigin,
  isIdpHubMessageOrigin,
} from '../idpHandoffBridge';

describe('idpHandoffBridge', () => {
  it('buildIdpHubOrigin points at auth.oxy.so', () => {
    expect(buildIdpHubOrigin()).toBe('https://auth.oxy.so');
  });

  it('buildIdpBridgeUrl encodes parent origin', () => {
    const url = new URL(buildIdpBridgeUrl('https://inbox.oxy.so'));
    expect(url.pathname).toBe('/bridge');
    expect(url.searchParams.get('origin')).toBe('https://inbox.oxy.so');
  });

  it('buildIdpHandoffEmbedUrl sets embed mode', () => {
    const url = new URL(buildIdpHandoffEmbedUrl('code123', 'https://accounts.oxy.so'));
    expect(url.pathname).toBe('/handoff');
    expect(url.searchParams.get('code')).toBe('code123');
    expect(url.searchParams.get('embed')).toBe('1');
    expect(url.searchParams.get('origin')).toBe('https://accounts.oxy.so');
  });

  it('isAllowedBridgeParentOrigin allows oxy.so ecosystem and official apexes', () => {
    expect(isAllowedBridgeParentOrigin('https://inbox.oxy.so')).toBe(true);
    expect(isAllowedBridgeParentOrigin('https://mention.earth')).toBe(true);
    expect(isAllowedBridgeParentOrigin('https://app.homiio.com')).toBe(true);
    expect(isAllowedBridgeParentOrigin('http://localhost:3002')).toBe(true);
  });

  it('isAllowedBridgeParentOrigin rejects unknown third-party origins', () => {
    expect(isAllowedBridgeParentOrigin('https://evil.example')).toBe(false);
  });

  it('isIdpHubMessageOrigin accepts only auth.oxy.so', () => {
    expect(isIdpHubMessageOrigin('https://auth.oxy.so')).toBe(true);
    expect(isIdpHubMessageOrigin('https://inbox.oxy.so')).toBe(false);
  });
});
