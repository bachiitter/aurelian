import { describe, expect, it } from 'vitest';
import { passkey } from './passkey.js';
import type { PasskeyState } from './passkey.js';

describe('passkey', () => {
  it('creates authentication and registration state', async () => {
    const states = new Map<string, PasskeyState>();
    const provider = passkey({
      consumeState({ state }) {
        const value = states.get(state) ?? null;
        states.delete(state);
        return value;
      },
      createState({ value }) {
        const state = `state_${states.size + 1}`;
        states.set(state, value);
        return state;
      },
      getCredential() {
        return null;
      },
      getRegistrationUser() {
        return {
          identity: { id: 'user_123' },
          name: 'user@example.com',
        };
      },
      origin: 'https://app.example.com',
      rpID: 'app.example.com',
      rpName: 'Example',
      saveCredential() {},
      updateCounter() {
        return false;
      },
    });
    const authenticationResponse = await provider.endpoints[
      'authentication/start'
    ].handler(new Request('https://auth.example.com'));
    const registrationResponse = await provider.endpoints[
      'registration/start'
    ].handler(
      new Request('https://auth.example.com', { method: 'POST' }),
    );
    const authentication: unknown = await authenticationResponse.json();
    const registration: unknown = await registrationResponse.json();

    expect(authentication).toMatchObject({ state: 'state_1' });
    expect(registration).toMatchObject({ state: 'state_2' });
    expect(states.get('state_1')).toMatchObject({ type: 'authentication' });
    expect(states.get('state_2')).toMatchObject({
      identity: { id: 'user_123' },
      type: 'registration',
    });
  });

  it('rejects malformed authentication responses', async () => {
    const provider = passkey({
      consumeState() {
        return null;
      },
      createState() {
        return 'state_123';
      },
      getCredential() {
        return null;
      },
      getRegistrationUser() {
        return null;
      },
      origin: 'https://app.example.com',
      rpID: 'app.example.com',
      rpName: 'Example',
      saveCredential() {},
      updateCounter() {
        return false;
      },
    });

    await expect(
      provider.authenticate({
        request: new Request('https://auth.example.com', {
          body: '{}',
          method: 'POST',
        }),
      }),
    ).resolves.toBeNull();
  });
});
