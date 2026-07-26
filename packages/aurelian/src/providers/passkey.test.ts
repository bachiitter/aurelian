import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../storage/memory.js';
import { passkey } from './passkey.js';
import { createProviderTestApp } from './test-utils.js';

describe('passkey', () => {
  it('creates authentication and registration state', async () => {
    const provider = passkey({
      handle(event) {
        if (event.type === 'registration-user') {
          return {
            identity: { id: 'user_123' },
            name: 'user@example.com',
          };
        }

        if (event.type === 'counter-update') {
          return false;
        }

        if (event.type === 'credential') {
          return null;
        }
      },
      origin: 'https://app.example.com',
      rpID: 'app.example.com',
      rpName: 'Example',
      storage: memoryStorage(),
    });
    const app = createProviderTestApp(provider);
    const authenticationResponse = await app.request('/authentication/start');
    const registrationResponse = await app.request('/registration/start', {
      method: 'POST',
    });
    const authentication: unknown = await authenticationResponse.json();
    const registration: unknown = await registrationResponse.json();

    expect(authentication).toMatchObject({ state: expect.any(String) });
    expect(registration).toMatchObject({ state: expect.any(String) });
  });

  it('rejects malformed authentication responses', async () => {
    const provider = passkey({
      handle(event) {
        if (event.type === 'counter-update') {
          return false;
        }

        return null;
      },
      origin: 'https://app.example.com',
      rpID: 'app.example.com',
      rpName: 'Example',
      storage: memoryStorage(),
    });
    const app = createProviderTestApp(provider);

    const response = await app.request('/authentication/verify', {
      body: '{}',
      method: 'POST',
    });

    await expect(response.json()).resolves.toBeNull();
  });
});
