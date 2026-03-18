import { z } from 'zod';

// DELETE /devices/:deviceId
export const deviceIdParams = z.object({
  deviceId: z.string().trim().min(1),
});
