/**
 * Hook to resolve CID inline image references in email HTML.
 *
 * Fetches signed File Manager URLs for inline attachments and replaces cid:
 * references in the HTML with the actual URLs. Returns a stable map of
 * messageId → resolvedHtml.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import type { OxyServices } from '@oxyhq/core';
import type { Message } from '@/services/emailApi';
import { resolveCidImages } from '@/utils/htmlTransform';

export function useCidResolver(
  messages: Message[],
  oxyServices: OxyServices | null | undefined,
  resetKey: string,
): Record<string, string> {
  const [cidMaps, setCidMaps] = useState<Record<string, Record<string, string>>>({});
  const resolvedIds = useRef(new Set<string>());

  // Reset when the displayed message changes
  useEffect(() => {
    setCidMaps({});
    resolvedIds.current = new Set();
  }, [resetKey]);

  // Fetch signed File Manager URLs for inline CID attachments
  useEffect(() => {
    if (!oxyServices) return;
    let cancelled = false;

    (async () => {
      const newEntries: [string, Record<string, string>][] = [];

      for (const msg of messages) {
        if (resolvedIds.current.has(msg._id)) continue;

        const inlineAtts = msg.attachments.filter(
          (a): a is typeof a & { contentId: string } =>
            Boolean(a.isInline && a.contentId),
        );

        resolvedIds.current.add(msg._id);
        if (inlineAtts.length === 0) continue;

        const cidMap: Record<string, string> = {};
        await Promise.all(
          inlineAtts.map(async (att) => {
            try {
              cidMap[att.contentId] = await oxyServices.getFileDownloadUrlAsync(att.fileId);
            } catch { /* skip failed attachments */ }
          }),
        );
        newEntries.push([msg._id, cidMap]);
      }

      if (!cancelled && newEntries.length > 0) {
        setCidMaps((prev) => {
          const next = { ...prev };
          for (const [id, map] of newEntries) next[id] = map;
          return next;
        });
      }
    })();

    return () => { cancelled = true; };
  }, [messages, oxyServices]);

  // Pre-compute resolved HTML per message — stable references
  return useMemo(() => {
    const map: Record<string, string> = {};
    for (const msg of messages) {
      if (!msg.html) continue;
      const cidMap = cidMaps[msg._id];
      map[msg._id] = cidMap ? resolveCidImages(msg.html, cidMap) : msg.html;
    }
    return map;
  }, [messages, cidMaps]);
}
