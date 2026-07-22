import type { AuthStorage } from './storage.js';

export type Env = {
  APP_ORIGIN: string;
  AUTH_ISSUER: string;
  AUTH_PRIVATE_KEY: string;
  AUTH_PUBLIC_KEY: string;
  AUTH_STORAGE: DurableObjectNamespace<AuthStorage>;
  DEMO_PASSWORD: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};
