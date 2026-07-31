import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import { Hono } from "hono";
import { sha, createRandomString } from "../crypto.js";
import type { ProviderIdentity } from "../profiles.js";
import type { StorageAdapter } from "../storage/types.js";
import type { MaybePromise, Provider, ProviderEnvironment } from "../types.js";

export type PasskeyCredential = WebAuthnCredential & {
  identity: ProviderIdentity;
};

export type PasskeyState =
  | {
      challenge: string;
      identity: ProviderIdentity;
      type: "registration";
    }
  | {
      challenge: string;
      type: "authentication";
    };

export type PasskeyRegistrationUser = {
  displayName?: string;
  excludeCredentials?: Array<{
    id: string;
    transports?: AuthenticatorTransportFuture[];
  }>;
  identity: ProviderIdentity;
  name: string;
};

export type PasskeyProviderEvent =
  | {
      id: string;
      type: "credential";
    }
  | {
      credential: WebAuthnCredential;
      identity: ProviderIdentity;
      request: Request;
      type: "credential-created";
    }
  | {
      credentialId: string;
      currentCounter: number;
      newCounter: number;
      type: "counter-update";
    }
  | {
      request: Request;
      type: "registration-user";
    };

export type PasskeyProviderResult =
  | PasskeyCredential
  | PasskeyRegistrationUser
  | boolean
  | null
  | void;

export type PasskeyOptions = {
  handle(event: PasskeyProviderEvent): MaybePromise<PasskeyProviderResult>;
  origin: string;
  rpID: string;
  rpName: string;
  stateTtl?: number;
  storage: StorageAdapter;
};

export type PasskeyProvider = Provider;

export function passkey(options: PasskeyOptions): PasskeyProvider {
  const router = new Hono<ProviderEnvironment>();
  const stateTtl = options.stateTtl ?? 5 * 60;

  if (!Number.isSafeInteger(stateTtl) || stateTtl <= 0) {
    throw new RangeError("passkey.stateTtl must be a positive integer.");
  }

  async function authenticate(
    request: Request,
    providerId: string,
  ): Promise<ProviderIdentity | null> {
    const body: {
      response?: AuthenticationResponseJSON;
      state?: unknown;
    } | null = await request.json().catch(() => null);

    if (
      !body?.response ||
      typeof body.response.id !== "string" ||
      typeof body.state !== "string" ||
      body.state.length === 0 ||
      body.state.length > 512
    ) {
      return null;
    }

    const state = await consumeState(providerId, request, body.state);
    const credentialResult = await options.handle({
      id: body.response.id,
      type: "credential",
    });
    const credential = isPasskeyCredential(credentialResult) ? credentialResult : null;

    if (state?.type !== "authentication" || !credential) {
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
      (await options.handle({
        credentialId: credential.id,
        currentCounter: credential.counter,
        newCounter,
        type: "counter-update",
      })) !== true
    ) {
      return null;
    }

    return credential.identity;
  }

  router.get("/authentication/start", async (context) => {
    const request = context.req.raw;
    const authenticationOptions = await generateAuthenticationOptions({
      rpID: options.rpID,
      userVerification: "required",
    });
    const state = await createState(context.var.aurelian.providerId, request, {
      challenge: authenticationOptions.challenge,
      type: "authentication",
    });

    return Response.json({ options: authenticationOptions, state });
  });

  router.post("/authentication/verify", (context) =>
    context.var.aurelian.authenticate(
      authenticate(context.req.raw, context.var.aurelian.providerId),
    ),
  );

  router.post("/registration/start", async (context) => {
    const request = context.req.raw;
    const userResult = await options.handle({
      request,
      type: "registration-user",
    });
    const user = isRegistrationUser(userResult) ? userResult : null;

    if (!user) {
      return new Response("Registration requires a session.", { status: 401 });
    }

    const registrationOptions = await generateRegistrationOptions({
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      excludeCredentials: user.excludeCredentials,
      rpID: options.rpID,
      rpName: options.rpName,
      userDisplayName: user.displayName ?? user.name,
      userID: new TextEncoder().encode(user.identity.id),
      userName: user.name,
    });
    const state = await createState(context.var.aurelian.providerId, request, {
      challenge: registrationOptions.challenge,
      identity: user.identity,
      type: "registration",
    });

    return Response.json({ options: registrationOptions, state });
  });

  router.post("/registration/verify", async (context) => {
    const request = context.req.raw;
    const body: {
      response?: RegistrationResponseJSON;
      state?: unknown;
    } | null = await request.json().catch(() => null);

    if (
      !body?.response ||
      typeof body.state !== "string" ||
      body.state.length === 0 ||
      body.state.length > 512
    ) {
      return new Response("Passkey registration failed.", { status: 400 });
    }

    const state = await consumeState(context.var.aurelian.providerId, request, body.state);

    if (state?.type !== "registration") {
      return new Response("Passkey registration failed.", { status: 400 });
    }

    const verification = await verifyRegistrationResponse({
      expectedChallenge: state.challenge,
      expectedOrigin: options.origin,
      expectedRPID: options.rpID,
      requireUserVerification: true,
      response: body.response,
    }).catch(() => null);

    if (!verification?.verified || !verification.registrationInfo) {
      return new Response("Passkey registration failed.", { status: 400 });
    }

    await options.handle({
      credential: verification.registrationInfo.credential,
      identity: state.identity,
      request,
      type: "credential-created",
    });

    return Response.json({ verified: true });
  });

  async function createState(
    providerId: string,
    request: Request,
    value: PasskeyState,
  ): Promise<string> {
    const state = createRandomString(48);
    const stateHash = await sha("SHA-256", state);

    await options.storage.set(
      getStateKey(providerId, stateHash),
      JSON.stringify({
        authorization: value.type === "registration" ? request.headers.get("authorization") : null,
        value,
      }),
      { ttl: stateTtl },
    );
    return state;
  }

  async function consumeState(
    providerId: string,
    request: Request,
    state: string,
  ): Promise<PasskeyState | null> {
    const stateHash = await sha("SHA-256", state);
    const serialized = await options.storage.consume(getStateKey(providerId, stateHash));
    const stored = parseStoredState(serialized);

    if (
      stored?.value.type === "registration" &&
      stored.authorization !== request.headers.get("authorization")
    ) {
      return null;
    }

    return stored?.value ?? null;
  }

  return { router };
}

function parseStoredState(value: string | null): {
  authorization: string | null;
  value: PasskeyState;
} | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value);
}

function getStateKey(providerId: string, stateHash: string): string {
  return `aurelian:provider:${providerId}:passkey:${stateHash}`;
}

function isPasskeyCredential(value: PasskeyProviderResult): value is PasskeyCredential {
  return (
    typeof value === "object" &&
    value !== null &&
    "counter" in value &&
    typeof value.counter === "number" &&
    "id" in value &&
    typeof value.id === "string" &&
    "identity" in value &&
    isProviderIdentity(value.identity) &&
    "publicKey" in value &&
    value.publicKey instanceof Uint8Array
  );
}

function isRegistrationUser(value: PasskeyProviderResult): value is PasskeyRegistrationUser {
  return (
    typeof value === "object" &&
    value !== null &&
    "identity" in value &&
    isProviderIdentity(value.identity) &&
    "name" in value &&
    typeof value.name === "string"
  );
}

function isProviderIdentity(value: unknown): value is ProviderIdentity {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0
  );
}
