import {
  createHash,
  createRandomString,
  createTokenService,
} from './crypto.js';
import { validateProfile } from './profiles.js';
import type {
  ProfilePayload,
  ProfileProperties,
  ProfileSchema,
  ProviderIdentity,
} from './profiles.js';
import type {
  Auth,
  CreateAuthOptions,
  IssueInput,
  Provider,
  Session,
  TokenResponse,
  VerifyResult,
} from './types.js';

const ACCESS_TTL_SECONDS = 10 * 60;
const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

type OAuthStateRecord = {
  clientState: string;
  codeChallenge: string;
  issuer: string;
  provider: string;
  redirectURI: string;
};

type AuthorizationCodeRecord<Profile> = {
  codeChallenge: string;
  issuer: string;
  profile: Profile;
  provider: string;
  redirectURI: string;
};

type RefreshTokenRecord<Profile> = {
  createdAt: number;
  expiresAt: number;
  issuer: string;
  profile: Profile;
  provider: string;
  sessionId: string;
};

export function createAuth<
  const Providers extends Record<string, Provider>,
  const Profiles extends ProfileSchema,
>(
  options: CreateAuthOptions<Providers, Profiles>,
): Auth<ProfilePayload<Profiles>> {
  type Profile = ProfilePayload<Profiles>;

  const accessTtl = options.access?.ttl ?? ACCESS_TTL_SECONDS;
  const refreshTtl = options.refresh?.ttl ?? REFRESH_TTL_SECONDS;
  const signingAlgorithm = options.signing.algorithm ?? 'RS256';

  if (!Number.isSafeInteger(accessTtl) || accessTtl <= 0) {
    throw new RangeError('access.ttl must be a positive integer.');
  }

  if (!Number.isSafeInteger(refreshTtl) || refreshTtl <= 0) {
    throw new RangeError('refresh.ttl must be a positive integer.');
  }

  const issuerURL = new URL(options.issuer);
  const isLoopback =
    issuerURL.hostname === 'localhost' ||
    issuerURL.hostname === '127.0.0.1' ||
    issuerURL.hostname === '[::1]';

  if (
    issuerURL.protocol !== 'https:' &&
    !(issuerURL.protocol === 'http:' && isLoopback)
  ) {
    throw new Error('issuer_invalid');
  }

  issuerURL.hash = '';
  issuerURL.search = '';

  const issuer = issuerURL.toString().replace(/\/$/, '');
  const issuerPath = issuerURL.pathname.replace(/\/$/, '');
  const tokenService = createTokenService<Profile>({
    ...options.signing,
    algorithm: signingAlgorithm,
    audience: options.access?.audience,
    claims: options.access?.claims,
  });

  function profile<Type extends keyof Profiles & string>(
    type: Type,
    properties: ProfileProperties<Profiles[Type]>,
  ): { properties: ProfileProperties<Profiles[Type]>; type: Type } {
    return { properties, type };
  }

  async function resolveProfile(
    provider: keyof Providers & string,
    identity: ProviderIdentity,
    request: Request,
  ): Promise<Profile> {
    return options.resolve({
      profile,
      request,
      response: { data: identity, provider },
    });
  }

  async function createTokenPair(
    input: {
      createdAt?: number;
      expiresAt?: number;
      profile: Profile;
      provider: string;
      sessionId?: string;
    },
  ): Promise<TokenResponse> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = input.expiresAt ?? now + refreshTtl;
    const sessionTtl = expiresAt - now;

    if (sessionTtl <= 0) {
      throw new Error('session_expired');
    }

    const validated = await validateProfile(input.profile, options.profiles);
    const profile = validated.profile;
    const accessTokenTtl = Math.min(accessTtl, sessionTtl);
    const session: Session<Profile> = {
      createdAt: input.createdAt ?? now,
      expiresAt,
      id: input.sessionId ?? `sess_${createRandomString(32)}`,
      profile,
      provider: input.provider,
    };
    const accessToken = await tokenService.issue({
      issuer,
      profile,
      profileId: validated.profileId,
      session,
      ttl: accessTokenTtl,
    });
    const refreshToken = `rt_${createRandomString(64)}`;
    const refreshTokenHash = await createHash(refreshToken);

    await options.storage.set(
      getStorageKey('refresh', refreshTokenHash),
      JSON.stringify({
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        issuer,
        profile,
        provider: input.provider,
        sessionId: session.id,
      } satisfies RefreshTokenRecord<Profile>),
      { ttl: sessionTtl },
    );

    return {
      accessToken,
      expiresIn: accessTokenTtl,
      refreshToken,
      tokenType: 'Bearer',
    };
  }

  async function issue(input: IssueInput<Profile>): Promise<TokenResponse> {
    return createTokenPair(input);
  }

  async function verify(accessToken: string): Promise<VerifyResult<Profile>> {
    return tokenService.verify(accessToken, issuer);
  }

  async function refresh(input: {
    refreshToken: string;
    request?: Request;
  }): Promise<TokenResponse | null> {
    if (!isRefreshToken(input.refreshToken)) {
      return null;
    }

    const refreshTokenHash = await createHash(input.refreshToken);
    const storedValue = await options.storage.consume(
      getStorageKey('refresh', refreshTokenHash),
    );
    const value: RefreshTokenRecord<Profile> | null = storedValue
      ? JSON.parse(storedValue)
      : null;

    const now = Math.floor(Date.now() / 1000);

    if (!value || value.issuer !== issuer || value.expiresAt <= now) {
      return null;
    }

    const profile = options.refresh?.resolve
      ? await options.refresh.resolve({
          profile: value.profile,
          provider: value.provider,
          request: input.request,
        })
      : value.profile;

    if (profile === null) {
      return null;
    }

    return createTokenPair(
      {
        createdAt: value.createdAt,
        expiresAt: value.expiresAt,
        profile,
        provider: value.provider,
        sessionId: value.sessionId,
      },
    );
  }

  async function revoke(input: { refreshToken: string }): Promise<void> {
    if (!isRefreshToken(input.refreshToken)) {
      return;
    }

    const refreshTokenHash = await createHash(input.refreshToken);

    await options.storage.consume(getStorageKey('refresh', refreshTokenHash));
  }

  async function jwks() {
    return tokenService.jwks();
  }

  async function handler(request: Request): Promise<Response> {
    const suppliedRequestId = request.headers.get('x-request-id');
    const requestId =
      suppliedRequestId && suppliedRequestId.length <= 128
        ? suppliedRequestId
        : createRandomString(24);

    try {
      const requestURL = new URL(request.url);
      const path =
        requestURL.origin === issuerURL.origin &&
        issuerPath &&
        (requestURL.pathname === issuerPath ||
          requestURL.pathname.startsWith(`${issuerPath}/`))
          ? requestURL.pathname.slice(issuerPath.length) || '/'
          : requestURL.pathname;
      const response = await route(request, path, requestId);
      const headers = new Headers(response.headers);

      headers.set('x-request-id', requestId);

      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    } catch (error) {
      if (options.onError) {
        try {
          await options.onError(error, { request, requestId });
        } catch {
          // The auth response must not depend on application error reporting.
        }
      }

      return errorResponse(
        requestId,
        'internal_server_error',
        500,
        'Internal server error.',
      );
    }
  }

  async function route(
    request: Request,
    path: string,
    requestId: string,
  ): Promise<Response> {
    if (request.method === 'POST' && path === '/token') {
      return exchange(request, requestId);
    }

    if (request.method === 'POST' && path === '/token/refresh') {
      return refreshRoute(request, requestId);
    }

    if (request.method === 'POST' && path === '/token/revoke') {
      return revokeRoute(request, requestId);
    }

    if (request.method === 'GET' && path === '/.well-known/jwks.json') {
      return jsonResponse(await jwks());
    }

    const endpointMatch = path.match(
      /^\/([A-Za-z0-9._~-]+)\/([A-Za-z0-9._~\/-]+)$/,
    );

    if (endpointMatch) {
      const providerId = endpointMatch[1];
      const endpointId = endpointMatch[2];

      if (providerId && endpointId === 'authorize' && request.method === 'GET') {
        return authorize(request, providerId, requestId);
      }

      if (providerId && endpointId === 'callback' && request.method === 'GET') {
        return callback(request, providerId, requestId);
      }

      if (
        providerId &&
        endpointId === 'authenticate' &&
        request.method === 'POST'
      ) {
        return authenticate(request, providerId, requestId);
      }

      const provider = providerId ? options.providers[providerId] : undefined;
      const endpoint = endpointId ? provider?.endpoints?.[endpointId] : undefined;

      if (!endpoint) {
        return errorResponse(
          requestId,
          'provider_endpoint_not_found',
          404,
          'Provider endpoint not found.',
        );
      }

      if (request.method !== endpoint.method) {
        return errorResponse(
          requestId,
          'method_not_allowed',
          405,
          `Use ${endpoint.method} for this provider endpoint.`,
        );
      }

      if ('authenticate' in endpoint) {
        return authenticate(request, providerId, requestId);
      }

      return endpoint.handler(request);
    }

    return errorResponse(
      requestId,
      'route_not_found',
      404,
      'Auth route not found.',
    );
  }

  async function authorize(
    request: Request,
    providerId: string,
    requestId: string,
  ): Promise<Response> {
    const provider = getProvider(providerId);

    if (!provider || provider.type !== 'oauth') {
      return errorResponse(
        requestId,
        'provider_not_found',
        404,
        'OAuth provider not found.',
      );
    }

    const url = new URL(request.url);
    const redirectURI = url.searchParams.get('redirect_uri');
    const redirectURL =
      redirectURI && URL.canParse(redirectURI) ? new URL(redirectURI) : null;

    if (
      !redirectURI ||
      !redirectURL ||
      (redirectURL.protocol !== 'https:' && redirectURL.protocol !== 'http:')
    ) {
      return errorResponse(
        requestId,
        'redirect_uri_invalid',
        400,
        'redirect_uri is invalid.',
      );
    }

    const requestedState = url.searchParams.get('state');

    if (requestedState !== null && !isValidState(requestedState)) {
      return errorResponse(
        requestId,
        'state_invalid',
        400,
        'state is invalid.',
      );
    }

    const codeChallenge = url.searchParams.get('code_challenge');
    const codeChallengeMethod = url.searchParams.get('code_challenge_method');

    if (
      !codeChallenge ||
      codeChallengeMethod !== 'S256' ||
      codeChallenge.length !== 43 ||
      !/^[A-Za-z0-9_-]+$/.test(codeChallenge)
    ) {
      return errorResponse(
        requestId,
        'code_challenge_invalid',
        400,
        'Only a valid S256 code challenge is supported.',
      );
    }

    const scope = url.searchParams.get('scope');

    if (scope && scope.length > 2048) {
      return errorResponse(
        requestId,
        'scope_invalid',
        400,
        'scope is invalid.',
      );
    }

    const clientState = requestedState ?? createRandomString(32);
    const providerState = createRandomString(48);
    const providerStateHash = await createHash(providerState);
    const callbackURL = `${issuer}/${providerId}/callback`;

    await options.storage.set(
      getStorageKey('state', providerStateHash),
      JSON.stringify({
        clientState,
        codeChallenge,
        issuer,
        provider: providerId,
        redirectURI,
      } satisfies OAuthStateRecord),
      { ttl: OAUTH_STATE_TTL_SECONDS },
    );

    const authorizationURL = await provider.authorizationUrl({
      callbackURL,
      request,
      scopes: scope?.split(' ').filter(Boolean),
      state: providerState,
    });

    if (
      authorizationURL.protocol !== 'https:' &&
      authorizationURL.protocol !== 'http:'
    ) {
      throw new Error('provider_authorization_url_invalid');
    }

    return Response.redirect(authorizationURL, 302);
  }

  async function callback(
    request: Request,
    providerId: string,
    requestId: string,
  ): Promise<Response> {
    const provider = getProvider(providerId);

    if (!provider || provider.type !== 'oauth') {
      return errorResponse(
        requestId,
        'provider_not_found',
        404,
        'OAuth provider not found.',
      );
    }

    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state || code.length > 4096 || !isValidState(state)) {
      return errorResponse(
        requestId,
        'callback_invalid',
        400,
        'code and state are required.',
      );
    }

    const stateHash = await createHash(state);
    const storedValue = await options.storage.consume(
      getStorageKey('state', stateHash),
    );
    const value: OAuthStateRecord | null = storedValue
      ? JSON.parse(storedValue)
      : null;

    if (
      !value ||
      value.issuer !== issuer ||
      value.provider !== providerId
    ) {
      return errorResponse(
        requestId,
        'state_invalid',
        400,
        'State is invalid or expired.',
      );
    }

    const identity = await provider.callback({
      callbackURL: `${issuer}/${providerId}/callback`,
      code,
      request,
      state,
    });

    const profile = await resolveProfile(
      providerId as keyof Providers & string,
      identity,
      request,
    );
    const authorizationCode = `ac_${createRandomString(64)}`;
    const authorizationCodeHash = await createHash(authorizationCode);

    await options.storage.set(
      getStorageKey('code', authorizationCodeHash),
      JSON.stringify({
        codeChallenge: value.codeChallenge,
        issuer,
        profile,
        provider: providerId,
        redirectURI: value.redirectURI,
      } satisfies AuthorizationCodeRecord<Profile>),
      { ttl: AUTHORIZATION_CODE_TTL_SECONDS },
    );

    const redirectURL = new URL(value.redirectURI);

    redirectURL.searchParams.set('code', authorizationCode);
    redirectURL.searchParams.set('state', value.clientState);

    return Response.redirect(redirectURL, 302);
  }

  async function authenticate(
    request: Request,
    providerId: string,
    requestId: string,
  ): Promise<Response> {
    const provider = getProvider(providerId);

    if (!provider || provider.type !== 'request') {
      return errorResponse(
        requestId,
        'provider_not_found',
        404,
        'Authentication provider not found.',
      );
    }

    const identity = await provider.authenticate({ request });

    if (!identity) {
      return errorResponse(
        requestId,
        'authentication_failed',
        401,
        'Authentication failed.',
      );
    }

    const profile = await resolveProfile(
      providerId as keyof Providers & string,
      identity,
      request,
    );
    const tokens = await createTokenPair({
      profile,
      provider: providerId,
    });

    return jsonResponse(tokens);
  }

  async function exchange(
    request: Request,
    requestId: string,
  ): Promise<Response> {
    const body = await readJSON<{
      code?: unknown;
      codeVerifier?: unknown;
      redirectURI?: unknown;
    }>(request);

    if (
      typeof body?.code !== 'string' ||
      typeof body.redirectURI !== 'string' ||
      !body.code.startsWith('ac_')
    ) {
      return errorResponse(
        requestId,
        'token_request_invalid',
        400,
        'code and redirectURI are required.',
      );
    }

    const codeHash = await createHash(body.code);
    const storedValue = await options.storage.consume(
      getStorageKey('code', codeHash),
    );
    const value: AuthorizationCodeRecord<Profile> | null = storedValue
      ? JSON.parse(storedValue)
      : null;

    if (
      !value ||
      value.issuer !== issuer ||
      value.redirectURI !== body.redirectURI
    ) {
      return errorResponse(
        requestId,
        'authorization_code_invalid',
        400,
        'Authorization code is invalid or expired.',
      );
    }

    if (typeof body.codeVerifier !== 'string') {
      return errorResponse(
        requestId,
        'code_verifier_required',
        400,
        'codeVerifier is required.',
      );
    }

    const challenge = await createHash(body.codeVerifier);

    if (challenge !== value.codeChallenge) {
      return errorResponse(
        requestId,
        'code_verifier_invalid',
        400,
        'codeVerifier is invalid.',
      );
    }

    return jsonResponse(
      await createTokenPair(
        {
          profile: value.profile,
          provider: value.provider,
        },
      ),
    );
  }

  async function refreshRoute(
    request: Request,
    requestId: string,
  ): Promise<Response> {
    const body = await readJSON<{ refreshToken?: unknown }>(request);

    if (typeof body?.refreshToken !== 'string') {
      return errorResponse(
        requestId,
        'refresh_request_invalid',
        400,
        'refreshToken is required.',
      );
    }

    const tokens = await refresh({
      refreshToken: body.refreshToken,
      request,
    });

    if (!tokens) {
      return errorResponse(
        requestId,
        'refresh_token_invalid',
        401,
        'Refresh token is invalid.',
      );
    }

    return jsonResponse(tokens);
  }

  async function revokeRoute(
    request: Request,
    requestId: string,
  ): Promise<Response> {
    const body = await readJSON<{ refreshToken?: unknown }>(request);

    if (typeof body?.refreshToken !== 'string') {
      return errorResponse(
        requestId,
        'revoke_request_invalid',
        400,
        'refreshToken is required.',
      );
    }

    await revoke({ refreshToken: body.refreshToken });

    return jsonResponse({ revoked: true });
  }

  function getProvider(providerId: string): Provider | undefined {
    return options.providers[providerId];
  }

  return { handler, issue, jwks, refresh, revoke, verify };
}

function getStorageKey(type: 'code' | 'refresh' | 'state', hash: string): string {
  return `aurelian:${type}:${hash}`;
}

function isRefreshToken(value: string): boolean {
  return value.startsWith('rt_') && value.length === 67;
}

function isValidState(value: string): boolean {
  return value.length > 0 && value.length <= 512;
}

async function readJSON<Value>(request: Request): Promise<Value | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function errorResponse(
  requestId: string,
  code: string,
  status: number,
  message: string,
): Response {
  return jsonResponse(
    {
      error: { code, message, status },
      meta: { requestId },
    },
    status,
  );
}
