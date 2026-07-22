import type { JWK, JWTPayload } from 'jose';
import type {
  ProfilePayload,
  ProfileResolver,
  ProfileSchema,
  ProviderIdentity,
} from './profiles.js';
import type { StorageAdapter } from './storage/types.js';

export type { ProviderIdentity } from './profiles.js';

export type MaybePromise<Value> = Value | Promise<Value>;

export type ProviderEndpoint =
  | {
      authenticate: true;
      method: 'POST';
    }
  | {
      handler(request: Request): MaybePromise<Response>;
      method: 'GET' | 'POST';
    };

type ProviderEndpoints = {
  endpoints?: Record<string, ProviderEndpoint>;
};

export type OAuthProvider = ProviderEndpoints & {
  authorizationUrl(input: {
    callbackURL: string;
    request: Request;
    scopes?: string[];
    state: string;
  }): MaybePromise<URL>;
  callback(input: {
    callbackURL: string;
    code: string;
    request: Request;
    state: string;
  }): MaybePromise<ProviderIdentity>;
  type: 'oauth';
};

export type RequestProvider = ProviderEndpoints & {
  authenticate(input: {
    request: Request;
  }): MaybePromise<ProviderIdentity | null>;
  type: 'request';
};

export type Provider = OAuthProvider | RequestProvider;

export type Session<Profile> = {
  createdAt: number;
  expiresAt: number;
  id: string;
  profile: Profile;
  provider: string;
};

export type TokenResponse = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  tokenType: 'Bearer';
};

export type AccessTokenClaims<Profile> = JWTPayload & {
  profile: Profile;
  sid: string;
  typ: 'access';
};

export type VerifyResult<Profile> =
  | {
      claims: AccessTokenClaims<Profile>;
      profile: Profile;
      valid: true;
    }
  | {
      reason: 'token_invalid';
      valid: false;
    };

export type CreateAuthOptions<
  Providers extends Record<string, Provider>,
  Profiles extends ProfileSchema,
> = {
  access?: {
    audience?: string | string[];
    claims?(input: {
      profile: ProfilePayload<Profiles>;
      session: Session<ProfilePayload<Profiles>>;
    }): MaybePromise<Record<string, unknown>>;
    ttl?: number;
  };
  issuer: string;
  onError?(error: unknown, context: {
    request: Request;
    requestId: string;
  }): MaybePromise<void>;
  profiles: Profiles;
  providers: Providers;
  refresh?: {
    resolve?(input: {
      profile: ProfilePayload<Profiles>;
      provider: string;
      request?: Request;
    }): MaybePromise<ProfilePayload<Profiles> | null>;
    ttl?: number;
  };
  resolve: ProfileResolver<Providers, Profiles>;
  signing: {
    algorithm?: string;
    keyId?: string;
    privateKey: string;
    publicKey: string;
  };
  storage: StorageAdapter;
};

export type IssueInput<Profile> = {
  profile: Profile;
  provider: string;
};

export type Auth<Profile> = {
  handler(request: Request): Promise<Response>;
  issue(input: IssueInput<Profile>): Promise<TokenResponse>;
  jwks(): Promise<{ keys: JWK[] }>;
  refresh(input: {
    refreshToken: string;
    request?: Request;
  }): Promise<TokenResponse | null>;
  revoke(input: { refreshToken: string }): Promise<void>;
  verify(accessToken: string): Promise<VerifyResult<Profile>>;
};
