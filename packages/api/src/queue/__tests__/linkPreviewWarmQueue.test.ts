/**
 * Regression test for the BullMQ warm enqueue failure
 * ("Custom Id cannot contain :"): the per-URL job id MUST be colon-free.
 */
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {} }));
jest.mock('../connection', () => ({ getQueueConnectionOptions: () => ({}) }));
jest.mock('../queueManager', () => ({ isQueueEnabled: () => false }));
jest.mock('../../services/linkPreview/linkPreviewService', () => ({
  linkPreviewService: { resolveAndStore: jest.fn() },
}));

import { linkPreviewWarmJobId } from '../linkPreviewWarm.queue';

describe('linkPreviewWarmJobId', () => {
  it('never contains a colon (BullMQ custom-id rule) and is stable per URL', () => {
    const url = 'https://youtu.be/mYDSSRS-B5U';
    const id = linkPreviewWarmJobId(url);
    expect(id).not.toContain(':');
    expect(id.startsWith('lp-')).toBe(true);
    expect(linkPreviewWarmJobId(url)).toBe(id); // deterministic
    expect(linkPreviewWarmJobId('https://vimeo.com/76979871')).not.toBe(id);
  });
});
