/**
 * Viewer-scoped query keys for single-profile fetches.
 *
 * `getUserById` / `getProfileByUsername` embed a viewer-relative `relationship`
 * when authenticated. React Query keys must include the active viewer id so an
 * anonymous cold-boot entry does not freeze once the session resolves.
 */

import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@oxyhq/core';
import { queryKeys } from '../../src/ui/hooks/queries/queryKeys';
import { useUserById, useUserByUsername } from '../../src/ui/hooks/queries/useAccountQueries';

interface MockOxyServices {
  getUserById: jest.Mock;
  getProfileByUsername: jest.Mock;
}

interface MockOxyState {
  oxyServices: MockOxyServices;
  user: { id: string } | null;
}

const ANON_PROFILE: User = {
  id: 'target-1',
  username: 'alice',
  name: { displayName: 'Alice' },
} as User;

const AUTH_PROFILE: User = {
  ...ANON_PROFILE,
  relationship: { isFollowing: false, followsYou: true },
} as User;

const makeServices = (): MockOxyServices => ({
  getUserById: jest.fn(async () => ANON_PROFILE),
  getProfileByUsername: jest.fn(async () => ANON_PROFILE),
});

let mockState: MockOxyState = {
  oxyServices: makeServices(),
  user: null,
};

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => mockState,
}));

const makeWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

describe('useUserById viewer scope', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockState = {
      oxyServices: makeServices(),
      user: null,
    };
  });

  it('refetches when the viewer session resolves', async () => {
    const { result, rerender } = renderHook(() => useUserById('target-1'), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockState.oxyServices.getUserById).toHaveBeenCalledTimes(1);
    expect(result.current.data?.relationship).toBeUndefined();

    mockState = {
      oxyServices: {
        ...makeServices(),
        getUserById: jest.fn(async () => AUTH_PROFILE),
      },
      user: { id: 'viewer-1' },
    };
    rerender();

    await waitFor(() => expect(result.current.data?.relationship?.followsYou).toBe(true));
    expect(mockState.oxyServices.getUserById).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(queryKeys.users.detailForViewer('target-1', ''))).toEqual(
      ANON_PROFILE,
    );
    expect(queryClient.getQueryData(queryKeys.users.detailForViewer('target-1', 'viewer-1'))).toEqual(
      AUTH_PROFILE,
    );
  });
});

describe('useUserByUsername viewer scope', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockState = {
      oxyServices: makeServices(),
      user: null,
    };
  });

  it('refetches when the viewer session resolves', async () => {
    const { result, rerender } = renderHook(() => useUserByUsername('alice'), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockState.oxyServices.getProfileByUsername).toHaveBeenCalledTimes(1);

    mockState = {
      oxyServices: {
        ...makeServices(),
        getProfileByUsername: jest.fn(async () => AUTH_PROFILE),
      },
      user: { id: 'viewer-1' },
    };
    rerender();

    await waitFor(() => expect(result.current.data?.relationship?.followsYou).toBe(true));
    expect(mockState.oxyServices.getProfileByUsername).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(queryKeys.users.byUsername('alice', 'viewer-1'))).toEqual(
      AUTH_PROFILE,
    );
  });
});
