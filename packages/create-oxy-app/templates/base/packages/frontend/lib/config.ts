/** Runtime configuration, read from `EXPO_PUBLIC_*` env vars (see `.env.example`). */

/** Backend API base URL. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://{{API_DOMAIN}}';

/** The app's registered Oxy client id (ApplicationCredential publicKey). */
export const OXY_CLIENT_ID = process.env.EXPO_PUBLIC_OXY_CLIENT_ID ?? '';
