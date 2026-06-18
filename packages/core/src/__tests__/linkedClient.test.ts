import { OxyServices } from '../OxyServices';

function createServices(): OxyServices {
  return new OxyServices({ baseURL: 'https://api.oxy.so' });
}

describe('OxyServices.createLinkedClient', () => {
  it('mirrors token changes from the session owner', () => {
    const oxy = createServices();
    const linked = oxy.createLinkedClient({ baseURL: 'https://api.syra.fm' });

    expect(linked.client.getAccessToken()).toBeNull();

    oxy.setTokens('access_1');
    expect(linked.client.getAccessToken()).toBe('access_1');

    oxy.setTokens('access_2');
    expect(linked.client.getAccessToken()).toBe('access_2');

    oxy.clearTokens();
    expect(linked.client.getAccessToken()).toBeNull();

    linked.dispose();
  });

  it('copies the current token when created after sign-in', () => {
    const oxy = createServices();
    oxy.setTokens('existing_access');

    const linked = oxy.createLinkedClient({ baseURL: 'https://api.syra.fm' });

    expect(linked.client.getAccessToken()).toBe('existing_access');

    linked.dispose();
  });

  it('delegates token refresh to the session owner', async () => {
    const oxy = createServices();
    const linked = oxy.createLinkedClient({ baseURL: 'https://api.syra.fm' });

    oxy.getClient().setAuthRefreshHandler(async () => 'refreshed_access');

    const refreshed = await linked.client.refreshAccessToken('preflight');

    expect(refreshed).toBe('refreshed_access');
    expect(oxy.getAccessToken()).toBe('refreshed_access');
    expect(linked.client.getAccessToken()).toBe('refreshed_access');

    linked.dispose();
  });

  it('clears the session owner when a linked response 401 cannot refresh', async () => {
    const oxy = createServices();
    oxy.setTokens('stale_access');
    const linked = oxy.createLinkedClient({ baseURL: 'https://api.syra.fm' });

    const refreshed = await linked.client.refreshAccessToken('response-401');

    expect(refreshed).toBeNull();
    expect(oxy.getAccessToken()).toBeNull();
    expect(linked.client.getAccessToken()).toBeNull();

    linked.dispose();
  });

  it('keeps the session owner intact when linked preflight refresh cannot refresh', async () => {
    const oxy = createServices();
    oxy.setTokens('existing_access');
    const linked = oxy.createLinkedClient({ baseURL: 'https://api.syra.fm' });

    const refreshed = await linked.client.refreshAccessToken('preflight');

    expect(refreshed).toBeNull();
    expect(oxy.getAccessToken()).toBe('existing_access');
    expect(linked.client.getAccessToken()).toBe('existing_access');

    linked.dispose();
  });

  it('stops mirroring after dispose', () => {
    const oxy = createServices();
    const linked = oxy.createLinkedClient({ baseURL: 'https://api.syra.fm' });

    oxy.setTokens('before_dispose');
    expect(linked.client.getAccessToken()).toBe('before_dispose');

    linked.dispose();
    oxy.setTokens('after_dispose');

    expect(linked.client.getAccessToken()).toBeNull();
  });
});
