import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Hono } from "hono";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { sha, createRandomString } from "./crypto.js";
import { createAuth } from "./server.js";
import { defineProfiles } from "./profiles.js";
import { memoryStorage } from "./storage/memory.js";
import type { OAuthFlow, ProviderEnvironment, TokenResponse } from "./types.js";

const ISSUER = "https://auth.example.com/auth";
const REDIRECT_URI = "https://app.example.com/callback";

const UserSchema: StandardSchemaV1<unknown, { id: string; refreshed?: boolean }> = {
  "~standard": {
    validate(value) {
      if (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "string"
      ) {
        return {
          value: {
            id: value.id.toLowerCase(),
            refreshed: "refreshed" in value && value.refreshed === true ? true : undefined,
          },
        };
      }

      return { issues: [{ message: "id is required" }] };
    },
    vendor: "aurelian-test",
    version: 1,
  },
};
const profiles = defineProfiles({ user: UserSchema });
let privateKey: string;
let publicKey: string;

beforeAll(async () => {
  const keyPair = await generateKeyPair("ES256", { extractable: true });

  [privateKey, publicKey] = await Promise.all([
    exportPKCS8(keyPair.privateKey),
    exportSPKI(keyPair.publicKey),
  ]);
});

describe("createAuth", () => {
  it("issues, rotates, verifies, and revokes an application-owned session", async () => {
    const passwordRouter = new Hono<ProviderEnvironment>();
    async function authenticate(request: Request) {
      const body: {
        email?: unknown;
        password?: unknown;
      } = await request.json();

      if (body.email !== "user@example.com" || body.password !== "password") {
        return null;
      }

      return {
        email: body.email,
        emailVerified: true,
        id: "USER_123",
      };
    }

    passwordRouter.post("/authenticate", (context) =>
      context.var.aurelian.authenticate(authenticate(context.req.raw)),
    );
    passwordRouter.post("/authentication/verify", (context) =>
      context.var.aurelian.authenticate(authenticate(context.req.raw)),
    );
    passwordRouter.get("/status", (context) => context.json({ available: true }));
    passwordRouter.get("/failure", () => Promise.reject("provider_failed"));

    const auth = createAuth({
      resolve({ profile, response }) {
        return profile("user", { id: response.data.id });
      },
      issuer: ISSUER,
      profiles,
      providers: {
        password: { router: passwordRouter },
      },
      refresh: {
        resolve({ profile }) {
          return {
            ...profile,
            properties: { ...profile.properties, refreshed: true },
          };
        },
      },
      signing: { algorithm: "ES256", privateKey, publicKey },
      storage: memoryStorage(),
    });
    const authentication = await auth.handler(
      jsonRequest(`${ISSUER}/password/authenticate`, {
        email: "user@example.com",
        password: "password",
      }),
    );
    const tokens = await readTokenResponse(authentication);
    const providerStatus = await auth.handler(new Request(`${ISSUER}/password/status`));
    const providerAuthentication = await auth.handler(
      jsonRequest(`${ISSUER}/password/authentication/verify`, {
        email: "user@example.com",
        password: "password",
      }),
    );
    const providerFailure = await auth.handler(new Request(`${ISSUER}/password/failure`));
    const verification = await auth.verify(tokens.accessToken);

    expect(authentication.status).toBe(200);
    expect(providerAuthentication.status).toBe(200);
    expect(providerFailure.status).toBe(500);
    await expect(providerStatus.json()).resolves.toEqual({ available: true });
    expect(verification.valid).toBe(true);

    if (verification.valid) {
      expect(verification.profile).toEqual({
        properties: { id: "user_123" },
        type: "user",
      });
      expect(verification.claims.sub).toBe("user_123");
    }

    const refreshResponse = await auth.handler(
      jsonRequest(`${ISSUER}/token/refresh`, {
        refreshToken: tokens.refreshToken,
      }),
    );
    const rotated = await readTokenResponse(refreshResponse);

    expect(refreshResponse.status).toBe(200);
    expect(await auth.refresh({ refreshToken: tokens.refreshToken })).toBeNull();

    const rotatedVerification = await auth.verify(rotated.accessToken);

    expect(rotatedVerification.valid).toBe(true);

    if (rotatedVerification.valid) {
      expect(rotatedVerification.profile).toEqual({
        properties: { id: "user_123", refreshed: true },
        type: "user",
      });
    }

    await auth.revoke({ refreshToken: rotated.refreshToken });

    expect(await auth.refresh({ refreshToken: rotated.refreshToken })).toBeNull();
  });

  it("exchanges an OAuth callback with isolated state and PKCE", async () => {
    const exampleRouter = new Hono<ProviderEnvironment>();
    const flow: OAuthFlow = {
      authorizationUrl({ callbackURL, state }) {
        const url = new URL("https://provider.example.com/authorize");

        url.searchParams.set("redirect_uri", callbackURL);
        url.searchParams.set("state", state);

        return url;
      },
      callback() {
        return { id: "oauth_user" };
      },
    };

    exampleRouter.get("/authorize", (context) => context.var.aurelian.authorize(flow));
    exampleRouter.get("/callback", (context) => context.var.aurelian.callback(flow));

    const auth = createAuth({
      resolve({ profile, response }) {
        return profile("user", { id: response.data.id });
      },
      issuer: ISSUER,
      profiles,
      providers: {
        example: { router: exampleRouter },
      },
      signing: { algorithm: "ES256", privateKey, publicKey },
      storage: memoryStorage(),
    });
    const codeVerifier = createRandomString(64);
    const codeChallenge = await sha("SHA-256", codeVerifier);
    const authorizeURL = new URL(`${ISSUER}/example/authorize`);

    authorizeURL.searchParams.set("redirect_uri", REDIRECT_URI);
    authorizeURL.searchParams.set("state", "client_state");

    const unprotectedAuthorization = await auth.handler(new Request(authorizeURL));

    expect(unprotectedAuthorization.status).toBe(400);

    authorizeURL.searchParams.set("code_challenge", codeChallenge);
    authorizeURL.searchParams.set("code_challenge_method", "S256");

    const authorization = await auth.handler(new Request(authorizeURL));
    const providerRedirect = new URL(getLocation(authorization));
    const providerState = providerRedirect.searchParams.get("state");

    expect(authorization.status).toBe(302);
    expect(providerRedirect.searchParams.get("redirect_uri")).toBe(`${ISSUER}/example/callback`);
    expect(providerState).not.toBe("client_state");

    if (!providerState) {
      throw new Error("provider_state_missing");
    }

    const callbackURL = new URL(`${ISSUER}/example/callback`);

    callbackURL.searchParams.set("code", "provider_code");
    callbackURL.searchParams.set("state", providerState);

    const headCallback = await auth.handler(new Request(callbackURL, { method: "HEAD" }));
    const callback = await auth.handler(new Request(callbackURL));
    const clientRedirect = new URL(getLocation(callback));
    const authorizationCode = clientRedirect.searchParams.get("code");

    expect(headCallback.status).toBe(404);
    expect(callback.status).toBe(302);
    expect(clientRedirect.origin + clientRedirect.pathname).toBe(REDIRECT_URI);
    expect(clientRedirect.searchParams.get("state")).toBe("client_state");

    if (!authorizationCode) {
      throw new Error("authorization_code_missing");
    }

    const exchange = await auth.handler(
      jsonRequest(`${ISSUER}/token`, {
        code: authorizationCode,
        codeVerifier,
        redirectURI: REDIRECT_URI,
      }),
    );
    const tokens = await readTokenResponse(exchange);
    const verification = await auth.verify(tokens.accessToken);

    expect(exchange.status).toBe(200);
    expect(verification.valid).toBe(true);
  });
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function readTokenResponse(response: Response): Promise<TokenResponse> {
  return response.json();
}

function getLocation(response: Response): string {
  const location = response.headers.get("location");

  if (!location) {
    throw new Error("location_missing");
  }

  return location;
}
