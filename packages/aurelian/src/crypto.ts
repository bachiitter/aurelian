import {
  base64url,
  calculateJwkThumbprint,
  exportJWK,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
} from 'jose';
import type { JWK } from 'jose';
import type {
  AccessTokenClaims,
  MaybePromise,
  Session,
  VerifyResult,
} from './types.js';

const RESERVED_CLAIMS = new Set([
  'aud',
  'exp',
  'iat',
  'iss',
  'jti',
  'nbf',
  'profile',
  'sid',
  'sub',
  'typ',
]);

export function createRandomString(length: number): string {
  const bytes = new Uint8Array(Math.ceil((length * 3) / 4));

  globalThis.crypto.getRandomValues(bytes);

  return base64url.encode(bytes).slice(0, length);
}

export async function createHash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);

  return base64url.encode(new Uint8Array(digest));
}

export function createTokenService<Profile>(options: {
  algorithm: string;
  audience?: string | string[];
  claims?(input: {
    profile: Profile;
    session: Session<Profile>;
  }): MaybePromise<Record<string, unknown>>;
  keyId?: string;
  privateKey: string;
  publicKey: string;
}) {
  const signingKeyPromise = (async function () {
    const [privateKey, publicKey] = await Promise.all([
      importPKCS8(options.privateKey, options.algorithm),
      importSPKI(options.publicKey, options.algorithm),
    ]);
    const exportedPublicKey = await exportJWK(publicKey);
    const keyId =
      options.keyId ?? (await calculateJwkThumbprint(exportedPublicKey));
    const publicJWK: JWK = {
      ...exportedPublicKey,
      alg: options.algorithm,
      kid: keyId,
      use: 'sig',
    };

    return { keyId, privateKey, publicJWK, publicKey };
  })();

  return {
    async issue(input: {
      issuer: string;
      profile: Profile;
      profileId: string;
      session: Session<Profile>;
      ttl: number;
    }): Promise<string> {
      const customClaims = options.claims
        ? await options.claims({
            profile: input.profile,
            session: input.session,
          })
        : {};

      for (const claim of Object.keys(customClaims)) {
        if (RESERVED_CLAIMS.has(claim)) {
          throw new Error(`reserved_claim:${claim}`);
        }
      }

      const now = Math.floor(Date.now() / 1000);
      const { keyId, privateKey } = await signingKeyPromise;
      const token = new SignJWT({
        ...customClaims,
        profile: input.profile,
        sid: input.session.id,
        typ: 'access',
      })
        .setProtectedHeader({ alg: options.algorithm, kid: keyId, typ: 'JWT' })
        .setIssuer(input.issuer)
        .setSubject(input.profileId)
        .setIssuedAt(now)
        .setNotBefore(now)
        .setJti(`jwt_${createRandomString(32)}`)
        .setExpirationTime(now + input.ttl);

      if (options.audience) {
        token.setAudience(options.audience);
      }

      return token.sign(privateKey);
    },
    async jwks(): Promise<{ keys: JWK[] }> {
      const { publicJWK } = await signingKeyPromise;

      return { keys: [{ ...publicJWK }] };
    },
    async verify(
      accessToken: string,
      issuer: string,
    ): Promise<VerifyResult<Profile>> {
      try {
        const { publicKey } = await signingKeyPromise;
        const result = await jwtVerify(accessToken, publicKey, {
          algorithms: [options.algorithm],
          audience: options.audience,
          issuer,
        });

        if (
          result.payload.typ !== 'access' ||
          typeof result.payload.sid !== 'string' ||
          result.payload.profile === undefined
        ) {
          return { reason: 'token_invalid', valid: false };
        }

        const profile = result.payload.profile as Profile;
        const claims: AccessTokenClaims<Profile> = {
          ...result.payload,
          profile,
          sid: result.payload.sid,
          typ: result.payload.typ,
        };

        return { claims, profile, valid: true };
      } catch {
        return { reason: 'token_invalid', valid: false };
      }
    },
  };
}
