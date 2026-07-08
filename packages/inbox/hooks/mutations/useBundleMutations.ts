import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@oxyhq/bloom';
import { useEmailStore } from '@/hooks/useEmail';
import type { Bundle } from '@/services/emailApi';

const BUNDLES_KEY = ['bundles'] as const;

async function optimisticBundles(
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (prev: Bundle[]) => Bundle[],
): Promise<{ prev: Bundle[] | undefined }> {
  await queryClient.cancelQueries({ queryKey: BUNDLES_KEY });
  const prev = queryClient.getQueryData<Bundle[]>(BUNDLES_KEY);
  queryClient.setQueryData<Bundle[]>(BUNDLES_KEY, (old) => updater(old ?? []));
  return { prev };
}

/**
 * Update a single bundle's server-backed fields (enabled, collapsed,
 * matchLabels, order). Renaming is intentionally NOT exposed — the
 * `PUT /email/bundles/:id` endpoint does not accept a `name`, so bundle
 * names are owned by the server-side auto-bundling logic.
 */
export function useUpdateBundle() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      bundleId,
      ...updates
    }: {
      bundleId: string;
      enabled?: boolean;
      collapsed?: boolean;
      matchLabels?: string[];
      order?: number;
    }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.updateBundle(bundleId, updates);
    },
    onMutate: async ({ bundleId, ...updates }) => {
      const { prev } = await optimisticBundles(queryClient, (bundles) =>
        bundles.map((b) => (b._id === bundleId ? { ...b, ...updates } : b)),
      );
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(BUNDLES_KEY, context.prev);
      toast.error('Failed to update bundle.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: BUNDLES_KEY });
    },
  });
}

/**
 * Reorder a bundle by swapping its `order` with the adjacent bundle in the
 * given direction. Applies the swap optimistically to the `['bundles']`
 * cache, then persists both bundles' new order.
 */
export function useReorderBundle() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      bundleId,
      direction,
    }: {
      bundleId: string;
      direction: 'up' | 'down';
    }) => {
      if (!api) throw new Error('Email API not initialized');
      const bundles = [...(queryClient.getQueryData<Bundle[]>(BUNDLES_KEY) ?? [])].sort(
        (a, b) => a.order - b.order,
      );
      const idx = bundles.findIndex((b) => b._id === bundleId);
      if (idx === -1) return;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= bundles.length) return;
      const current = bundles[idx];
      const neighbour = bundles[swapIdx];
      await Promise.all([
        api.updateBundle(current._id, { order: neighbour.order }),
        api.updateBundle(neighbour._id, { order: current.order }),
      ]);
    },
    onMutate: async ({ bundleId, direction }) => {
      const { prev } = await optimisticBundles(queryClient, (bundles) => {
        const sorted = [...bundles].sort((a, b) => a.order - b.order);
        const idx = sorted.findIndex((b) => b._id === bundleId);
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return bundles;
        const currentOrder = sorted[idx].order;
        sorted[idx] = { ...sorted[idx], order: sorted[swapIdx].order };
        sorted[swapIdx] = { ...sorted[swapIdx], order: currentOrder };
        return sorted;
      });
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(BUNDLES_KEY, context.prev);
      toast.error('Failed to reorder bundle.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: BUNDLES_KEY });
    },
  });
}
