import { z } from 'zod';

// POST /notifications
export const createNotificationSchema = z.object({
  recipientId: z.string().trim().min(1),
  actorId: z.string().trim().min(1),
  type: z.string().trim().min(1),
  entityId: z.string().trim().min(1),
  entityType: z.string().trim().min(1),
  title: z.string().trim().optional(),
  message: z.string().trim().optional(),
  data: z.record(z.any()).optional(),
});

// Params with :id
export const notificationIdParams = z.object({
  id: z.string().trim().min(1),
});
