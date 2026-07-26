import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../storage/memory.js';
import { password, pbkdf2PasswordHasher } from './password.js';
import { createProviderTestApp } from './test-utils.js';

describe('password', () => {
  it('registers, authenticates, and resets a password', async () => {
    const accounts = new Map<
      string,
      { identity: { email: string; id: string }; passwordHash: string }
    >();
    const codes = new Map<string, string>();
    const provider = password({
      handle(event) {
        if (event.type === 'account') {
          return accounts.get(event.identifier) ?? null;
        }

        if (event.type === 'send-code') {
          codes.set(event.purpose, event.code);
          return;
        }

        if (event.type === 'registration') {
          const identity = {
            email: event.identifier,
            id: `user:${event.identifier}`,
          };

          accounts.set(event.identifier, {
            identity,
            passwordHash: event.passwordHash,
          });
          return identity;
        }

        const account = accounts.get(event.identifier);

        if (!account) {
          return false;
        }

        accounts.set(event.identifier, {
          ...account,
          passwordHash: event.passwordHash,
        });
        return true;
      },
      hasher: pbkdf2PasswordHasher({ iterations: 1 }),
      normalizeIdentifier(identifier) {
        return identifier.toLowerCase();
      },
      storage: memoryStorage(),
    });
    const app = createProviderTestApp(provider, { providerId: 'password' });
    const registrationStart = await app.request('/registration/start', {
      body: JSON.stringify({
        identifier: 'USER@EXAMPLE.COM',
        password: 'initial-password',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const registration: { state: string } = await registrationStart.json();
    const registrationCode = codes.get('registration');

    if (!registrationCode) {
      throw new Error('registration_code_missing');
    }

    const registrationVerify = await app.request('/registration/verify', {
      body: JSON.stringify({
        code: registrationCode,
        state: registration.state,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const authentication = await app.request('/authenticate', {
      body: JSON.stringify({
        identifier: 'user@example.com',
        password: 'initial-password',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    await expect(registrationVerify.json()).resolves.toMatchObject({
      id: 'user:user@example.com',
    });
    await expect(authentication.json()).resolves.toMatchObject({
      id: 'user:user@example.com',
    });

    const resetStart = await app.request('/password-reset/start', {
      body: JSON.stringify({ identifier: 'user@example.com' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const resetCodeState: { state: string } = await resetStart.json();
    const resetCode = codes.get('password-reset');

    if (!resetCode) {
      throw new Error('reset_code_missing');
    }

    const resetVerify = await app.request('/password-reset/verify', {
      body: JSON.stringify({ code: resetCode, state: resetCodeState.state }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const reset: { state: string } = await resetVerify.json();
    const resetComplete = await app.request('/password-reset/complete', {
      body: JSON.stringify({
        password: 'next-password',
        state: reset.state,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const nextAuthentication = await app.request('/authenticate', {
      body: JSON.stringify({
        identifier: 'user@example.com',
        password: 'next-password',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    await expect(resetComplete.json()).resolves.toEqual({ reset: true });
    await expect(nextAuthentication.json()).resolves.toMatchObject({
      id: 'user:user@example.com',
    });
  });
});
