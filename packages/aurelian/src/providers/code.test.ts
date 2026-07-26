import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../storage/memory.js';
import { code } from './code.js';
import { createProviderTestApp } from './test-utils.js';

describe('code', () => {
  it('creates and consumes one-time codes', async () => {
    const deliveredCodes: string[] = [];
    const provider = code({
      identify({ identifier }) {
        return { email: identifier, emailVerified: true, id: identifier };
      },
      send({ code: value }) {
        deliveredCodes.push(value);
      },
      storage: memoryStorage(),
    });
    const app = createProviderTestApp(provider, { providerId: 'code' });
    const identifier = 'user@example.com';

    await app.request('/request', {
      body: JSON.stringify({ identifier }),
      method: 'POST',
    });
    const value = deliveredCodes[0];

    if (!value) {
      throw new Error('code_not_delivered');
    }

    const authentication = await app.request('/authenticate', {
      body: JSON.stringify({ code: value, identifier }),
      method: 'POST',
    });

    expect(value).toMatch(/^\d{6}$/);
    await expect(authentication.json()).resolves.toEqual({
      email: identifier,
      emailVerified: true,
      id: identifier,
    });
    const replay = await app.request('/authenticate', {
      body: JSON.stringify({ code: value, identifier }),
      method: 'POST',
    });

    await expect(replay.json()).resolves.toBeNull();
  });

  it('consumes the code after an incorrect attempt', async () => {
    const deliveredCodes: string[] = [];
    const provider = code({
      identify({ identifier }) {
        return { id: identifier };
      },
      send({ code: value }) {
        deliveredCodes.push(value);
      },
      storage: memoryStorage(),
    });
    const app = createProviderTestApp(provider, { providerId: 'code' });
    const identifier = '+15555550123';

    await app.request('/request', {
      body: JSON.stringify({ identifier }),
      method: 'POST',
    });
    const value = deliveredCodes[0];

    if (!value) {
      throw new Error('code_not_delivered');
    }

    const incorrectCode = value === '000000' ? '111111' : '000000';

    const incorrect = await app.request('/authenticate', {
      body: JSON.stringify({ code: incorrectCode, identifier }),
      method: 'POST',
    });
    const retry = await app.request('/authenticate', {
      body: JSON.stringify({ code: value, identifier }),
      method: 'POST',
    });

    await expect(incorrect.json()).resolves.toBeNull();
    await expect(retry.json()).resolves.toBeNull();
  });
});
