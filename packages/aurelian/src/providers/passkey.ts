import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import type { ProviderIdentity } from '../profiles.js';
import type {
  MaybePromise,
  RequestProvider,
} from '../types.js';

export type PasskeyCredential = WebAuthnCredential & {
  identity: ProviderIdentity;
};

export type PasskeyState =
  | {
      challenge: string;
      identity: ProviderIdentity;
      type: 'registration';
    }
  | {
      challenge: string;
      type: 'authentication';
    };

export type PasskeyOptions = {
  consumeState(input: {
    request: Request;
    state: string;
  }): MaybePromise<PasskeyState | null>;
  createState(input: {
    request: Request;
    value: PasskeyState;
  }): MaybePromise<string>;
  getCredential(id: string): MaybePromise<PasskeyCredential | null>;
  getRegistrationUser(request: Request): MaybePromise<{
    displayName?: string;
    excludeCredentials?: Array<{
      id: string;
      transports?: AuthenticatorTransportFuture[];
    }>;
    identity: ProviderIdentity;
    name: string;
  } | null>;
  origin: string;
  rpID: string;
  rpName: string;
  saveCredential(input: {
    credential: WebAuthnCredential;
    identity: ProviderIdentity;
    request: Request;
  }): MaybePromise<void>;
  updateCounter(input: {
    credentialId: string;
    currentCounter: number;
    newCounter: number;
  }): MaybePromise<boolean>;
};

export type PasskeyProvider = RequestProvider & {
  endpoints: {
    'authentication/start': {
      handler(request: Request): MaybePromise<Response>;
      method: 'GET';
    };
    'authentication/verify': {
      authenticate: true;
      method: 'POST';
    };
    'registration/start': {
      handler(request: Request): MaybePromise<Response>;
      method: 'POST';
    };
    'registration/verify': {
      handler(request: Request): MaybePromise<Response>;
      method: 'POST';
    };
  };
};

export function passkey(options: PasskeyOptions): PasskeyProvider {
  return {
    async authenticate({ request }) {
      const body: {
        response?: AuthenticationResponseJSON;
        state?: unknown;
      } | null = await request.json().catch(() => null);

      if (
        !body?.response ||
        typeof body.response.id !== 'string' ||
        typeof body.state !== 'string' ||
        body.state.length === 0 ||
        body.state.length > 512
      ) {
        return null;
      }

      const state = await options.consumeState({
        request,
        state: body.state,
      });
      const credential = await options.getCredential(body.response.id);

      if (state?.type !== 'authentication' || !credential) {
        return null;
      }

      const verification = await verifyAuthenticationResponse({
        credential,
        expectedChallenge: state.challenge,
        expectedOrigin: options.origin,
        expectedRPID: options.rpID,
        requireUserVerification: true,
        response: body.response,
      }).catch(() => null);

      if (!verification?.verified) {
        return null;
      }

      const newCounter = verification.authenticationInfo.newCounter;

      if (
        (credential.counter !== 0 || newCounter !== 0) &&
        !(await options.updateCounter({
          credentialId: credential.id,
          currentCounter: credential.counter,
          newCounter,
        }))
      ) {
        return null;
      }

      return credential.identity;
    },
    endpoints: {
      'authentication/start': {
        async handler(request) {
          const authenticationOptions = await generateAuthenticationOptions({
            rpID: options.rpID,
            userVerification: 'required',
          });
          const state = await options.createState({
            request,
            value: {
              challenge: authenticationOptions.challenge,
              type: 'authentication',
            },
          });

          if (!state || state.length > 512) {
            throw new Error('passkey_state_invalid');
          }

          return Response.json({ options: authenticationOptions, state });
        },
        method: 'GET',
      },
      'authentication/verify': {
        authenticate: true,
        method: 'POST',
      },
      'registration/start': {
        async handler(request) {
          const user = await options.getRegistrationUser(request);

          if (!user) {
            return new Response('Registration requires a session.', {
              status: 401,
            });
          }

          const registrationOptions = await generateRegistrationOptions({
            authenticatorSelection: {
              residentKey: 'required',
              userVerification: 'required',
            },
            excludeCredentials: user.excludeCredentials,
            rpID: options.rpID,
            rpName: options.rpName,
            userDisplayName: user.displayName ?? user.name,
            userID: new TextEncoder().encode(user.identity.id),
            userName: user.name,
          });
          const state = await options.createState({
            request,
            value: {
              challenge: registrationOptions.challenge,
              identity: user.identity,
              type: 'registration',
            },
          });

          if (!state || state.length > 512) {
            throw new Error('passkey_state_invalid');
          }

          return Response.json({ options: registrationOptions, state });
        },
        method: 'POST',
      },
      'registration/verify': {
        async handler(request) {
          const body: {
            response?: RegistrationResponseJSON;
            state?: unknown;
          } | null = await request.json().catch(() => null);

          if (
            !body?.response ||
            typeof body.state !== 'string' ||
            body.state.length === 0 ||
            body.state.length > 512
          ) {
            return new Response('Passkey registration failed.', {
              status: 400,
            });
          }

          const state = await options.consumeState({
            request,
            state: body.state,
          });

          if (state?.type !== 'registration') {
            return new Response('Passkey registration failed.', {
              status: 400,
            });
          }

          const verification = await verifyRegistrationResponse({
            expectedChallenge: state.challenge,
            expectedOrigin: options.origin,
            expectedRPID: options.rpID,
            requireUserVerification: true,
            response: body.response,
          }).catch(() => null);

          if (!verification?.verified || !verification.registrationInfo) {
            return new Response('Passkey registration failed.', {
              status: 400,
            });
          }

          await options.saveCredential({
            credential: verification.registrationInfo.credential,
            identity: state.identity,
            request,
          });

          return Response.json({ verified: true });
        },
        method: 'POST',
      },
    },
    type: 'request',
  };
}
