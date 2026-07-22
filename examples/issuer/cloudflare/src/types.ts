import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
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

export type StoredCredential = {
  counter: number;
  email: string;
  id: string;
  publicKey: number[];
  transports?: AuthenticatorTransportFuture[];
  userId: string;
};
