import { z } from 'zod';

// POST /auth/social/google
export const googleSignInSchema = z.object({
  idToken: z.string().trim().min(1),
  deviceName: z.string().trim().optional(),
  deviceFingerprint: z.string().trim().optional(),
});

// POST /auth/social/apple
export const appleSignInSchema = z.object({
  idToken: z.string().trim().min(1),
  name: z.string().trim().optional(),
  deviceName: z.string().trim().optional(),
  deviceFingerprint: z.string().trim().optional(),
});

// POST /auth/social/github
export const githubSignInSchema = z.object({
  code: z.string().trim().min(1),
  deviceName: z.string().trim().optional(),
  deviceFingerprint: z.string().trim().optional(),
});
