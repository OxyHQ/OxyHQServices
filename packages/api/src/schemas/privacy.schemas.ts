import { z } from 'zod';

// Params with :id (privacy settings)
export const privacyUserIdParams = z.object({
  id: z.string().trim().min(1),
});

// Params with :targetId (block/restrict)
export const targetIdParams = z.object({
  targetId: z.string().trim().min(1),
});
