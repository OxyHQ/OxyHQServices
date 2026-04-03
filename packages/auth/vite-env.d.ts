/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OXY_API_URL: string;
  readonly VITE_OXY_AUTH_URL: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_APPLE_CLIENT_ID: string;
  readonly VITE_GITHUB_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
