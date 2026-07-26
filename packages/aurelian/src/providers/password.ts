import { Hono } from 'hono';
import { base64url } from 'jose';
import { createHash, createRandomString } from '../crypto.js';
import type { ProviderIdentity } from '../profiles.js';
import type { StorageAdapter } from '../storage/types.js';
import type {
  MaybePromise,
  Provider,
  ProviderEnvironment,
} from '../types.js';

const DEFAULT_CODE_TTL = 10 * 60;
const DEFAULT_ITERATIONS = 600_000;
const DEFAULT_RESET_TTL = 10 * 60;

type RegistrationState = {
  codeHash: string;
  identifier: string;
  passwordHash: string;
  type: 'registration';
};

type PasswordResetCodeState = {
  codeHash: string;
  identifier: string;
  type: 'password-reset-code';
};

type PasswordResetState = {
  identifier: string;
  type: 'password-reset';
};

type PasswordState =
  | PasswordResetCodeState
  | PasswordResetState
  | RegistrationState;

export type PasswordHasher = {
  hash(password: string): MaybePromise<string>;
  verify(password: string, passwordHash: string): MaybePromise<boolean>;
};

export type PasswordAccount = {
  identity: ProviderIdentity;
  passwordHash: string;
};

export type PasswordProviderEvent =
  | {
      identifier: string;
      request: Request;
      type: 'account';
    }
  | {
      code: string;
      identifier: string;
      purpose: 'password-reset' | 'registration';
      request: Request;
      type: 'send-code';
    }
  | {
      identifier: string;
      passwordHash: string;
      request: Request;
      type: 'registration';
    }
  | {
      identifier: string;
      passwordHash: string;
      request: Request;
      type: 'password-reset';
    };

export type PasswordProviderResult =
  | PasswordAccount
  | ProviderIdentity
  | boolean
  | null
  | void;

export type PasswordOptions = {
  codeTtl?: number;
  handle(
    event: PasswordProviderEvent,
  ): MaybePromise<PasswordProviderResult>;
  hasher?: PasswordHasher;
  normalizeIdentifier?(identifier: string): string;
  resetTtl?: number;
  storage: StorageAdapter;
  validatePassword?(password: string): MaybePromise<string | null | void>;
};

export function password(options: PasswordOptions): Provider {
  const codeTtl = options.codeTtl ?? DEFAULT_CODE_TTL;
  const hasher = options.hasher ?? pbkdf2PasswordHasher();
  const resetTtl = options.resetTtl ?? DEFAULT_RESET_TTL;
  const router = new Hono<ProviderEnvironment>();

  if (!Number.isSafeInteger(codeTtl) || codeTtl <= 0) {
    throw new RangeError('password.codeTtl must be a positive integer.');
  }

  if (!Number.isSafeInteger(resetTtl) || resetTtl <= 0) {
    throw new RangeError('password.resetTtl must be a positive integer.');
  }

  function normalizeIdentifier(identifier: string): string {
    return options.normalizeIdentifier?.(identifier) ?? identifier;
  }

  async function validatePassword(password: string): Promise<string | null> {
    if (!password || password.length > 1024) {
      return 'Password is invalid.';
    }

    return (await options.validatePassword?.(password)) ?? null;
  }

  router.post('/authenticate', async (context) => {
    const request = context.req.raw;
    const body = await readCredentials(request);

    if (!body) {
      return context.var.aurelian.authenticate(null);
    }

    const identifier = normalizeIdentifier(body.identifier);
    const accountResult = await options.handle({
      identifier,
      request,
      type: 'account',
    });
    const account = isPasswordAccount(accountResult) ? accountResult : null;
    const isValid = account
      ? await hasher.verify(body.password, account.passwordHash)
      : false;

    return context.var.aurelian.authenticate(
      isValid ? account?.identity ?? null : null,
    );
  });

  router.post('/registration/start', async (context) => {
    const request = context.req.raw;
    const body = await readCredentials(request);

    if (!body) {
      return passwordError('registration_invalid', 400, 'Registration is invalid.');
    }

    const identifier = normalizeIdentifier(body.identifier);
    const validationError = await validatePassword(body.password);

    if (validationError) {
      return passwordError('password_invalid', 400, validationError);
    }

    const account = await options.handle({
      identifier,
      request,
      type: 'account',
    });

    if (isPasswordAccount(account)) {
      return passwordError(
        'identifier_unavailable',
        409,
        'Identifier is unavailable.',
      );
    }

    const code = createVerificationCode();
    const state = await createState(
      context.var.aurelian.providerId,
      {
        codeHash: await createHash(code),
        identifier,
        passwordHash: await hasher.hash(body.password),
        type: 'registration',
      },
      codeTtl,
    );

    await options.handle({
      code,
      identifier,
      purpose: 'registration',
      request,
      type: 'send-code',
    });
    return Response.json({ state });
  });

  router.post('/registration/verify', async (context) => {
    const request = context.req.raw;
    const body = await readCode(request);
    const state = body
      ? await consumeState(context.var.aurelian.providerId, body.state)
      : null;

    if (
      state?.type !== 'registration' ||
      (await createHash(body?.code ?? '')) !== state.codeHash
    ) {
      return passwordError(
        'registration_invalid',
        400,
        'Registration is invalid or expired.',
      );
    }

    const result = await options.handle({
      identifier: state.identifier,
      passwordHash: state.passwordHash,
      request,
      type: 'registration',
    });

    return context.var.aurelian.authenticate(
      isProviderIdentity(result) ? result : null,
    );
  });

  router.post('/password-reset/start', async (context) => {
    const request = context.req.raw;
    const identifier = await readIdentifier(request);

    if (!identifier) {
      return passwordError(
        'password_reset_invalid',
        400,
        'Password reset is invalid.',
      );
    }

    const normalized = normalizeIdentifier(identifier);
    const code = createVerificationCode();
    const state = await createState(
      context.var.aurelian.providerId,
      {
        codeHash: await createHash(code),
        identifier: normalized,
        type: 'password-reset-code',
      },
      codeTtl,
    );

    await options.handle({
      code,
      identifier: normalized,
      purpose: 'password-reset',
      request,
      type: 'send-code',
    });
    return Response.json({ state });
  });

  router.post('/password-reset/verify', async (context) => {
    const body = await readCode(context.req.raw);
    const state = body
      ? await consumeState(context.var.aurelian.providerId, body.state)
      : null;

    if (
      state?.type !== 'password-reset-code' ||
      (await createHash(body?.code ?? '')) !== state.codeHash
    ) {
      return passwordError(
        'password_reset_invalid',
        400,
        'Password reset is invalid or expired.',
      );
    }

    const nextState = await createState(
      context.var.aurelian.providerId,
      { identifier: state.identifier, type: 'password-reset' },
      resetTtl,
    );

    return Response.json({ state: nextState });
  });

  router.post('/password-reset/complete', async (context) => {
    const request = context.req.raw;
    const body: { password?: unknown; state?: unknown } | null = await request
      .json()
      .catch(() => null);
    const state =
      typeof body?.state === 'string'
        ? await consumeState(context.var.aurelian.providerId, body.state)
        : null;

    if (state?.type !== 'password-reset' || typeof body?.password !== 'string') {
      return passwordError(
        'password_reset_invalid',
        400,
        'Password reset is invalid or expired.',
      );
    }

    const validationError = await validatePassword(body.password);

    if (validationError) {
      return passwordError('password_invalid', 400, validationError);
    }

    await options.handle({
      identifier: state.identifier,
      passwordHash: await hasher.hash(body.password),
      request,
      type: 'password-reset',
    });
    return Response.json({ reset: true });
  });

  async function createState(
    providerId: string,
    value: PasswordState,
    ttl: number,
  ): Promise<string> {
    const state = createRandomString(48);
    const stateHash = await createHash(state);

    await options.storage.set(
      getStateKey(providerId, stateHash),
      JSON.stringify(value),
      { ttl },
    );
    return state;
  }

  async function consumeState(
    providerId: string,
    state: string,
  ): Promise<PasswordState | null> {
    if (!state || state.length > 512) {
      return null;
    }

    const stateHash = await createHash(state);
    const value = await options.storage.consume(getStateKey(providerId, stateHash));

    return parseState(value);
  }

  return { router };
}

export function pbkdf2PasswordHasher(options?: {
  iterations?: number;
}): PasswordHasher {
  const iterations = options?.iterations ?? DEFAULT_ITERATIONS;

  if (!Number.isSafeInteger(iterations) || iterations <= 0) {
    throw new RangeError('password.iterations must be a positive integer.');
  }

  return {
    async hash(password) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await derivePassword(password, salt, iterations);

      return `pbkdf2-sha256$${iterations}$${base64url.encode(salt)}$${base64url.encode(hash)}`;
    },
    async verify(password, passwordHash) {
      const [algorithm, iterationsValue, saltValue, expectedValue] =
        passwordHash.split('$');
      const parsedIterations = Number(iterationsValue);

      if (
        algorithm !== 'pbkdf2-sha256' ||
        !Number.isSafeInteger(parsedIterations) ||
        parsedIterations <= 0 ||
        !saltValue ||
        !expectedValue
      ) {
        return false;
      }

      const actual = await derivePassword(
        password,
        base64url.decode(saltValue),
        parsedIterations,
      );

      return timingSafeEqual(actual, base64url.decode(expectedValue));
    },
  };
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const normalizedSalt = new Uint8Array(salt);
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const value = await crypto.subtle.deriveBits(
    { hash: 'SHA-256', iterations, name: 'PBKDF2', salt: normalizedSalt },
    material,
    256,
  );

  return new Uint8Array(value);
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

function createVerificationCode(): string {
  const maximum = 1_000_000;
  const limit = Math.floor(0x1_0000_0000 / maximum) * maximum;
  const values = new Uint32Array(1);

  do {
    crypto.getRandomValues(values);
  } while ((values[0] ?? 0) >= limit);

  return String((values[0] ?? 0) % maximum).padStart(6, '0');
}

async function readCredentials(request: Request): Promise<{
  identifier: string;
  password: string;
} | null> {
  const body: { identifier?: unknown; password?: unknown } | null = await request
    .json()
    .catch(() => null);

  if (
    typeof body?.identifier !== 'string' ||
    body.identifier.length === 0 ||
    body.identifier.length > 512 ||
    typeof body.password !== 'string' ||
    body.password.length === 0 ||
    body.password.length > 1024
  ) {
    return null;
  }

  return { identifier: body.identifier, password: body.password };
}

async function readIdentifier(request: Request): Promise<string | null> {
  const body: { identifier?: unknown } | null = await request
    .json()
    .catch(() => null);

  return typeof body?.identifier === 'string' &&
    body.identifier.length > 0 &&
    body.identifier.length <= 512
    ? body.identifier
    : null;
}

async function readCode(request: Request): Promise<{
  code: string;
  state: string;
} | null> {
  const body: { code?: unknown; state?: unknown } | null = await request
    .json()
    .catch(() => null);

  if (
    typeof body?.code !== 'string' ||
    !/^\d{6}$/.test(body.code) ||
    typeof body.state !== 'string' ||
    body.state.length === 0 ||
    body.state.length > 512
  ) {
    return null;
  }

  return { code: body.code, state: body.state };
}

function parseState(value: string | null): PasswordState | null {
  if (!value) {
    return null;
  }

  const state: unknown = JSON.parse(value);

  if (
    typeof state !== 'object' ||
    state === null ||
    !('type' in state) ||
    !('identifier' in state) ||
    typeof state.identifier !== 'string'
  ) {
    return null;
  }

  if (state.type === 'password-reset') {
    return { identifier: state.identifier, type: state.type };
  }

  if (
    (state.type === 'registration' || state.type === 'password-reset-code') &&
    'codeHash' in state &&
    typeof state.codeHash === 'string'
  ) {
    if (
      state.type === 'registration' &&
      'passwordHash' in state &&
      typeof state.passwordHash === 'string'
    ) {
      return {
        codeHash: state.codeHash,
        identifier: state.identifier,
        passwordHash: state.passwordHash,
        type: state.type,
      };
    }

    if (state.type === 'password-reset-code') {
      return {
        codeHash: state.codeHash,
        identifier: state.identifier,
        type: state.type,
      };
    }
  }

  return null;
}

function isPasswordAccount(value: PasswordProviderResult): value is PasswordAccount {
  return (
    typeof value === 'object' &&
    value !== null &&
    'identity' in value &&
    isProviderIdentity(value.identity) &&
    'passwordHash' in value &&
    typeof value.passwordHash === 'string'
  );
}

function isProviderIdentity(value: unknown): value is ProviderIdentity {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0
  );
}

function getStateKey(providerId: string, stateHash: string): string {
  return `aurelian:provider:${providerId}:password:${stateHash}`;
}

function passwordError(code: string, status: number, message: string): Response {
  return Response.json({ error: { code, message, status } }, { status });
}
