import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
// import {
//   createRefreshToken,
//   createSigningKey,
//   generateNumericCode,
//   getRefreshTokenStorageKey,
// } from "./server/crypto";
// import { errorResponse } from "./server/errors";
// import { createJWKS, issueAccessToken, verifyAccessToken } from "./server/jwt";
// import {
//   createProfile,
//   getProfileSubject,
//   validateProfile,
// } from "./server/profile";
// import {
//   getBearerToken,
//   getIssuer,
//   isAllowedRedirectURI,
//   isRecord,
//   readJson,
// } from "./server/request";
//
import type {
  // AttemptRecord,
  // AuthCodeRecord,
  CreateAuthOptions,
  // EmailVerificationRecord,
  Prettify,
  // RefreshRecord,
  // Session,
  // StateRecord,
  // TokenResponse,
  // VerifyResult,
} from "./types";
import type { Provider } from "./providers/types";
import type { ProfileSchema } from "./profiles";
// import { generateRandomString } from "./utils/random";

const DEFAULT_ACCESS_TTL_SECONDS = 60 * 60; // 1 Hour
const DEFAULT_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 Year

export function createAuth<
  Providers extends Record<string, Provider>,
  Profiles extends ProfileSchema,
  Result = {
    [key in keyof Providers]: Prettify<{
      provider: key & (Providers[key] extends Provider<infer T> ? T : {});
    }>;
  }[keyof Providers],
>(options: CreateAuthOptions<Providers, Profiles, Result>) {
  const hono = new Hono();

  const storage = options.storage;
  const accessTtl = options.ttl.access ?? DEFAULT_ACCESS_TTL_SECONDS;
  const refreshTtl = options.ttl.refresh ?? DEFAULT_REFRESH_TTL_SECONDS;
  // const signingKeyPromise = createSigningKey(options.signing);
  //
  // function fail(
  //   c: Parameters<typeof errorResponse>[0],
  //   code: string,
  //   status: number,
  //   message: string,
  // ): Response {
  //   return errorResponse(c, code, status, message);
  // }
  //
  // hono.onError((_error, c) => {
  //   return fail(c, "internal_server_error", 500, "Internal server error.");
  // });
  //

  if (options.logger === true) {
    hono.use(logger());
  }

  if (typeof options.logger === "function") {
    hono.use(logger(options.logger));
  }

  hono.use(
    cors({
      allowHeaders: ["*"],
      allowMethods: ["GET", "POST"],
      credentials: false,
      origin: "*",
    }),
  );

  // hono.get("/:provider/authorize", async (c) => {
  //   const providerId = c.req.param("provider");
  //   const provider = options.providers[providerId];
  //   const redirectURI = c.req.query("redirect_uri");
  //
  //   if (!provider) {
  //     return fail(c, "provider_not_found", 404, "Provider not found.");
  //   }
  //
  //   if (provider.type === "credentials") {
  //     return c.json({
  //       provider: provider.id,
  //       type: "credentials",
  //     });
  //   }
  //
  //   if (provider.type === "email") {
  //     return c.json({
  //       length: provider.length,
  //       provider: provider.id,
  //       type: "code",
  //     });
  //   }
  //
  //   if (!redirectURI) {
  //     return fail(c, "redirect_uri_required", 400, "redirect_uri is required.");
  //   }
  //
  //   if (!isAllowedRedirectURI(redirectURI, options.redirectURIs)) {
  //     return fail(
  //       c,
  //       "redirect_uri_untrusted",
  //       400,
  //       "redirect_uri is not allowed.",
  //     );
  //   }
  //
  //   const codeChallenge = c.req.query("code_challenge");
  //   const codeChallengeMethod = c.req.query("code_challenge_method");
  //   const scopes = c.req.query("scope")?.split(" ").filter(Boolean);
  //
  //   if (
  //     codeChallenge &&
  //     codeChallengeMethod &&
  //     codeChallengeMethod !== "S256"
  //   ) {
  //     return fail(
  //       c,
  //       "code_challenge_method_invalid",
  //       400,
  //       "code_challenge_method must be S256.",
  //     );
  //   }
  //
  //   const requestedState = c.req.query("state");
  //
  //   if (
  //     requestedState !== undefined &&
  //     (requestedState.length === 0 || requestedState.length > 512)
  //   ) {
  //     return fail(c, "state_invalid", 400, "state is invalid.");
  //   }
  //
  //   const state = requestedState ?? generateRandomString(32);
  //   const stateHash = await sha256Base64Url(state);
  //
  //   await storage.set<StateRecord>(
  //     getStateStorageKey(stateHash),
  //     {
  //       codeChallenge,
  //       provider: providerId,
  //       redirectURI,
  //       scopes,
  //     },
  //     { ttl: STATE_TTL_SECONDS },
  //   );
  //
  //   const url = await provider.authorizationUrl({ redirectURI, scopes, state });
  //
  //   return c.redirect(url.toString());
  // });
  //
  // hono.post("/:provider/authorize", async (c) => {
  //   const providerId = c.req.param("provider");
  //   const provider = options.providers[providerId];
  //
  //   if (!provider || provider.type !== "email") {
  //     return fail(c, "provider_not_found", 404, "Code provider not found.");
  //   }
  //
  //   const body = await readJson(c.req.raw);
  //
  //   if (!isRecord(body) || typeof body.email !== "string") {
  //     return fail(c, "code_request_invalid", 400, "email is required.");
  //   }
  //
  //   const email = body.email;
  //   const code = generateNumericCode(provider.length);
  //   const emailHash = await sha256Base64Url(email);
  //   const codeHash = await sha256Base64Url(`${provider.id}:${email}:${code}`);
  //   const attemptsKey = getAttemptStorageKey(
  //     "email-code",
  //     provider.id,
  //     emailHash,
  //   );
  //
  //   await storage.delete(attemptsKey);
  //   await storage.set<EmailVerificationRecord>(
  //     getEmailCodeStorageKey(provider.id, emailHash, codeHash),
  //     {
  //       code,
  //       email,
  //       provider: provider.id,
  //     },
  //     { ttl: provider.ttl },
  //   );
  //   await provider.send({ code, email, request: c.req.raw });
  //
  //   return c.json({ sent: true });
  // });
  //
  // hono.get("/:provider/callback", async (c) => {
  //   const providerId = c.req.param("provider");
  //   const code = c.req.query("code");
  //   const state = c.req.query("state");
  //   const provider = options.providers[providerId];
  //
  //   if (!provider || provider.type !== "oauth") {
  //     return fail(c, "provider_not_found", 404, "Provider not found.");
  //   }
  //
  //   if (!code || !state) {
  //     return fail(c, "callback_invalid", 400, "code and state are required.");
  //   }
  //
  //   const stateHash = await sha256Base64Url(state);
  //   const stateRecord = await storage.consume<StateRecord>(
  //     getStateStorageKey(stateHash),
  //   );
  //
  //   if (!stateRecord || stateRecord.provider !== providerId) {
  //     return fail(c, "state_invalid", 400, "State is invalid or expired.");
  //   }
  //
  //   const providerData = await provider.callback({
  //     code,
  //     redirectURI: stateRecord.redirectURI,
  //     request: c.req.raw,
  //     state,
  //   });
  //   const profile = await options.resolve({
  //     response: {
  //       data: providerData,
  //       provider: providerId,
  //     },
  //     profile: createProfile,
  //     request: c.req.raw,
  //   });
  //   const validatedProfile = await validateProfile(profile, options.profiles);
  //   const authorizationCode = generateRandomString(48);
  //   const authorizationCodeHash = await sha256Base64Url(authorizationCode);
  //
  //   await storage.set<AuthCodeRecord>(
  //     getAuthCodeStorageKey(authorizationCodeHash),
  //     {
  //       codeChallenge: stateRecord.codeChallenge,
  //       profile: validatedProfile,
  //       provider: providerId,
  //       redirectURI: stateRecord.redirectURI,
  //     },
  //     { ttl: AUTH_CODE_TTL_SECONDS },
  //   );
  //
  //   const redirectURL = new URL(stateRecord.redirectURI);
  //   redirectURL.searchParams.set("code", authorizationCode);
  //   redirectURL.searchParams.set("state", state);
  //
  //   return c.redirect(redirectURL.toString());
  // });
  //
  // hono.post("/:provider/callback", async (c) => {
  //   const providerId = c.req.param("provider");
  //   const provider = options.providers[providerId];
  //
  //   if (
  //     !provider ||
  //     (provider.type !== "credentials" && provider.type !== "email")
  //   ) {
  //     return fail(c, "provider_not_found", 404, "Provider not found.");
  //   }
  //
  //   const body = await readJson(c.req.raw);
  //
  //   if (provider.type === "email") {
  //     if (
  //       !isRecord(body) ||
  //       typeof body.email !== "string" ||
  //       typeof body.code !== "string"
  //     ) {
  //       return fail(
  //         c,
  //         "code_callback_invalid",
  //         400,
  //         "email and code are required.",
  //       );
  //     }
  //
  //     const code = body.code;
  //     const email = body.email;
  //     const emailHash = await sha256Base64Url(email);
  //     const attemptsKey = getAttemptStorageKey(
  //       "email-code",
  //       provider.id,
  //       emailHash,
  //     );
  //
  //     if (await isAttemptLimitReached(attemptsKey, EMAIL_CODE_ATTEMPT_LIMIT)) {
  //       return fail(
  //         c,
  //         "code_attempts_exceeded",
  //         429,
  //         "Too many invalid code attempts.",
  //       );
  //     }
  //
  //     const codeHash = await sha256Base64Url(`${provider.id}:${email}:${code}`);
  //     const key = getEmailCodeStorageKey(provider.id, emailHash, codeHash);
  //     const record = await storage.consume<EmailVerificationRecord>(key);
  //
  //     if (!record || record.provider !== provider.id) {
  //       await incrementAttemptCount(
  //         attemptsKey,
  //         EMAIL_CODE_ATTEMPT_TTL_SECONDS,
  //       );
  //       return fail(c, "code_invalid", 400, "Code is invalid or expired.");
  //     }
  //
  //     const providerData = await provider.verify({
  //       code,
  //       email,
  //       request: c.req.raw,
  //     });
  //
  //     if (!providerData) {
  //       await incrementAttemptCount(
  //         attemptsKey,
  //         EMAIL_CODE_ATTEMPT_TTL_SECONDS,
  //       );
  //       return fail(c, "code_invalid", 400, "Code is invalid.");
  //     }
  //
  //     await storage.delete(attemptsKey);
  //
  //     const profile = await options.resolve({
  //       response: {
  //         data: providerData,
  //         provider: providerId,
  //       },
  //       profile: createProfile,
  //       request: c.req.raw,
  //     });
  //     const response = await issue({
  //       profile,
  //       provider: providerId,
  //       request: c.req.raw,
  //     });
  //
  //     return c.json(response);
  //   }
  //
  //   if (
  //     !isRecord(body) ||
  //     typeof body.email !== "string" ||
  //     typeof body.password !== "string"
  //   ) {
  //     return fail(
  //       c,
  //       "password_request_invalid",
  //       400,
  //       "email and password are required.",
  //     );
  //   }
  //
  //   const email = body.email;
  //   const password = body.password;
  //   const emailHash = await sha256Base64Url(email);
  //   const attemptsKey = getAttemptStorageKey(
  //     "password",
  //     provider.id,
  //     emailHash,
  //   );
  //
  //   if (await isAttemptLimitReached(attemptsKey, PASSWORD_ATTEMPT_LIMIT)) {
  //     return fail(
  //       c,
  //       "password_attempts_exceeded",
  //       429,
  //       "Too many invalid password attempts.",
  //     );
  //   }
  //
  //   const providerData = await provider.login({
  //     email,
  //     password,
  //     request: c.req.raw,
  //   });
  //
  //   if (!providerData) {
  //     await incrementAttemptCount(attemptsKey, PASSWORD_ATTEMPT_TTL_SECONDS);
  //     return fail(
  //       c,
  //       "credentials_invalid",
  //       401,
  //       "Email or password is invalid.",
  //     );
  //   }
  //
  //   await storage.delete(attemptsKey);
  //
  //   const response = await resolveAndIssue(providerId, providerData, c.req.raw);
  //
  //   return c.json(response);
  // });
  //
  // hono.post("/:provider/login", async (c) => {
  //   const providerId = c.req.param("provider");
  //   const provider = options.providers[providerId];
  //
  //   if (!provider || provider.type !== "credentials") {
  //     return fail(c, "provider_not_found", 404, "Password provider not found.");
  //   }
  //
  //   const body = await readJson(c.req.raw);
  //
  //   if (
  //     !isRecord(body) ||
  //     typeof body.email !== "string" ||
  //     typeof body.password !== "string"
  //   ) {
  //     return fail(
  //       c,
  //       "password_request_invalid",
  //       400,
  //       "email and password are required.",
  //     );
  //   }
  //
  //   const email = body.email;
  //   const password = body.password;
  //   const emailHash = await sha256Base64Url(email);
  //   const attemptsKey = getAttemptStorageKey(
  //     "password",
  //     provider.id,
  //     emailHash,
  //   );
  //
  //   if (await isAttemptLimitReached(attemptsKey, PASSWORD_ATTEMPT_LIMIT)) {
  //     return fail(
  //       c,
  //       "password_attempts_exceeded",
  //       429,
  //       "Too many invalid password attempts.",
  //     );
  //   }
  //
  //   const providerData = await provider.login({
  //     email,
  //     password,
  //     request: c.req.raw,
  //   });
  //
  //   if (!providerData) {
  //     await incrementAttemptCount(attemptsKey, PASSWORD_ATTEMPT_TTL_SECONDS);
  //     return fail(
  //       c,
  //       "credentials_invalid",
  //       401,
  //       "Email or password is invalid.",
  //     );
  //   }
  //
  //   await storage.delete(attemptsKey);
  //
  //   const response = await resolveAndIssue(providerId, providerData, c.req.raw);
  //
  //   return c.json(response);
  // });
  //
  // hono.post("/:provider/register", async (c) => {
  //   const providerId = c.req.param("provider");
  //   const provider = options.providers[providerId];
  //
  //   if (!provider || provider.type !== "credentials") {
  //     return fail(c, "provider_not_found", 404, "Password provider not found.");
  //   }
  //
  //   const body = await readJson(c.req.raw);
  //
  //   if (
  //     !isRecord(body) ||
  //     typeof body.email !== "string" ||
  //     typeof body.password !== "string"
  //   ) {
  //     return fail(
  //       c,
  //       "register_request_invalid",
  //       400,
  //       "email and password are required.",
  //     );
  //   }
  //
  //   const email = body.email;
  //   const password = body.password;
  //   const providerData = await provider.register({
  //     email,
  //     password,
  //     request: c.req.raw,
  //   });
  //
  //   if (!providerData) {
  //     return fail(c, "register_invalid", 400, "Registration failed.");
  //   }
  //
  //   const response = await resolveAndIssue(providerId, providerData, c.req.raw);
  //
  //   return c.json(response);
  // });
  //
  // hono.post("/:provider/change", async (c) => {
  //   const providerId = c.req.param("provider");
  //   const provider = options.providers[providerId];
  //
  //   if (!provider || provider.type !== "credentials") {
  //     return fail(c, "provider_not_found", 404, "Password provider not found.");
  //   }
  //
  //   const body = await readJson(c.req.raw);
  //
  //   if (
  //     !isRecord(body) ||
  //     typeof body.currentPassword !== "string" ||
  //     typeof body.email !== "string" ||
  //     typeof body.newPassword !== "string"
  //   ) {
  //     return fail(
  //       c,
  //       "password_change_request_invalid",
  //       400,
  //       "email, currentPassword, and newPassword are required.",
  //     );
  //   }
  //
  //   const currentPassword = body.currentPassword;
  //   const email = body.email;
  //   const newPassword = body.newPassword;
  //   const accessToken = getBearerToken(c.req.raw);
  //
  //   if (!accessToken) {
  //     return fail(
  //       c,
  //       "access_token_required",
  //       401,
  //       "Bearer access token is required.",
  //     );
  //   }
  //
  //   const result = await verify(accessToken, c.req.raw);
  //
  //   if (!result.valid) {
  //     return fail(c, "access_token_invalid", 401, "Access token is invalid.");
  //   }
  //
  //   if (getProfileSubject(result.profile) !== email) {
  //     return fail(
  //       c,
  //       "password_change_forbidden",
  //       403,
  //       "Password can only be changed for the current profile.",
  //     );
  //   }
  //
  //   const changed = await provider.change({
  //     currentPassword,
  //     email,
  //     newPassword,
  //     request: c.req.raw,
  //   });
  //
  //   if (!changed) {
  //     return fail(c, "password_change_invalid", 400, "Password change failed.");
  //   }
  //
  //   return c.json({ changed: true });
  // });
  //
  // hono.post("/token", async (c) => {
  //   const body = await readJson(c.req.raw);
  //
  //   if (
  //     !isRecord(body) ||
  //     typeof body.code !== "string" ||
  //     typeof body.redirectURI !== "string"
  //   ) {
  //     return fail(
  //       c,
  //       "token_request_invalid",
  //       400,
  //       "code and redirectURI are required.",
  //     );
  //   }
  //
  //   const codeHash = await sha256Base64Url(body.code);
  //   const codeRecord = await storage.consume<AuthCodeRecord>(
  //     getAuthCodeStorageKey(codeHash),
  //   );
  //
  //   if (!codeRecord) {
  //     return fail(
  //       c,
  //       "code_invalid",
  //       400,
  //       "Authorization code is invalid or expired.",
  //     );
  //   }
  //
  //   if (codeRecord.redirectURI !== body.redirectURI) {
  //     return fail(
  //       c,
  //       "redirect_uri_invalid",
  //       400,
  //       "redirectURI does not match the authorization request.",
  //     );
  //   }
  //
  //   if (codeRecord.codeChallenge) {
  //     if (typeof body.codeVerifier !== "string") {
  //       return fail(
  //         c,
  //         "code_verifier_required",
  //         400,
  //         "codeVerifier is required.",
  //       );
  //     }
  //
  //     const codeChallenge = await sha256Base64Url(body.codeVerifier);
  //
  //     if (codeChallenge !== codeRecord.codeChallenge) {
  //       return fail(
  //         c,
  //         "code_verifier_invalid",
  //         400,
  //         "codeVerifier is invalid.",
  //       );
  //     }
  //   }
  //
  //   const response = await issueForProfile(
  //     codeRecord.profile as Profile,
  //     codeRecord.provider,
  //     c.req.raw,
  //   );
  //
  //   return c.json(response);
  // });
  //
  // hono.post("/token/refresh", async (c) => {
  //   const body = await readJson(c.req.raw);
  //
  //   if (!isRecord(body) || typeof body.refreshToken !== "string") {
  //     return fail(
  //       c,
  //       "refresh_request_invalid",
  //       400,
  //       "refreshToken is required.",
  //     );
  //   }
  //
  //   const result = await refresh({
  //     refreshToken: body.refreshToken,
  //     request: c.req.raw,
  //   });
  //
  //   if (!result) {
  //     return fail(c, "refresh_token_invalid", 401, "Refresh token is invalid.");
  //   }
  //
  //   return c.json(result);
  // });
  //
  // hono.post("/token/revoke", async (c) => {
  //   const body = await readJson(c.req.raw);
  //
  //   if (!isRecord(body) || typeof body.refreshToken !== "string") {
  //     return fail(
  //       c,
  //       "revoke_request_invalid",
  //       400,
  //       "refreshToken is required.",
  //     );
  //   }
  //
  //   await revoke({ refreshToken: body.refreshToken });
  //
  //   return c.json({ revoked: true });
  // });
  //
  // hono.get("/.well-known/jwks.json", async (c) => {
  //   const signingKey = await signingKeyPromise;
  //
  //   return c.json(await createJWKS(signingKey));
  // });
  //
  // async function issue(input: {
  //   profile: Profile;
  //   provider: string;
  //   request?: Request;
  // }): Promise<TokenResponse> {
  //   const profile = await validateProfile(input.profile, options.profiles);
  //
  //   return issueForProfile(profile, input.provider, input.request);
  // }
  //
  // async function resolveAndIssue(
  //   provider: string,
  //   data: unknown,
  //   request: Request,
  // ): Promise<TokenResponse> {
  //   const profile = await options.resolve({
  //     response: {
  //       data,
  //       provider,
  //     },
  //     profile: createProfile,
  //     request,
  //   });
  //
  //   return issue({ profile, provider, request });
  // }
  //
  // async function verify(
  //   accessToken: string,
  //   request?: Request,
  // ): Promise<VerifyResult<Profile>> {
  //   const issuer = getIssuer(options.issuer, request);
  //   const signingKey = await signingKeyPromise;
  //
  //   return await verifyAccessToken<Profile>({
  //     accessToken,
  //     issuer,
  //     signingKey,
  //   });
  // }
  //
  // async function refresh(input: {
  //   refreshToken: string;
  //   request?: Request;
  // }): Promise<TokenResponse | null> {
  //   const refreshTokenKey = await getRefreshTokenStorageKey(input.refreshToken);
  //
  //   if (!refreshTokenKey) {
  //     return null;
  //   }
  //
  //   const refreshRecord = await storage.consume<RefreshRecord>(refreshTokenKey);
  //
  //   if (!refreshRecord || refreshRecord.expiresAt <= now()) {
  //     return null;
  //   }
  //
  //   return issueForProfile(
  //     refreshRecord.profile as Profile,
  //     refreshRecord.provider,
  //     input.request,
  //   );
  // }
  //
  // async function revoke(input: { refreshToken: string }): Promise<void> {
  //   const refreshTokenKey = await getRefreshTokenStorageKey(input.refreshToken);
  //
  //   if (!refreshTokenKey) {
  //     return;
  //   }
  //
  //   await storage.delete(refreshTokenKey);
  // }
  //
  // async function issueForProfile(
  //   profile: Profile,
  //   provider: string,
  //   request?: Request,
  // ): Promise<TokenResponse> {
  //   const timestamp = now();
  //   const subject = getProfileSubject(profile);
  //   const refreshToken = await createRefreshToken(subject);
  //   const sessionId = `sess_${refreshToken.subjectHash}`;
  //   const session: Session = {
  //     createdAt: timestamp,
  //     expiresAt: timestamp + refreshTtl,
  //     id: sessionId,
  //     profileId: subject,
  //     profileType: profile.type,
  //     provider,
  //     refreshTokenHash: refreshToken.refreshTokenHash,
  //     updatedAt: timestamp,
  //   };
  //
  //   await storage.set<RefreshRecord>(
  //     refreshToken.storageKey,
  //     {
  //       createdAt: timestamp,
  //       expiresAt: timestamp + refreshTtl,
  //       profile,
  //       provider,
  //       refreshTokenHash: refreshToken.refreshTokenHash,
  //       subject,
  //       updatedAt: timestamp,
  //     },
  //     { ttl: refreshTtl },
  //   );
  //
  //   const signingKey = await signingKeyPromise;
  //   const issuer = getIssuer(options.issuer, request);
  //   const extension = options.tokens?.access?.extend
  //     ? await options.tokens.access.extend({ profile, session })
  //     : {};
  //   const accessToken = await issueAccessToken({
  //     accessTtl,
  //     claims: extension,
  //     issuer,
  //     profile,
  //     session,
  //     signingKey,
  //     timestamp,
  //   });
  //
  //   return {
  //     accessToken,
  //     expiresIn: accessTtl,
  //     refreshToken: refreshToken.refreshToken,
  //     tokenType: "Bearer",
  //   };
  // }
  //
  // async function incrementAttemptCount(
  //   key: string,
  //   ttl: number,
  // ): Promise<number> {
  //   const record = await storage.get<AttemptRecord>(key);
  //   const count = (record?.count ?? 0) + 1;
  //
  //   await storage.set<AttemptRecord>(key, { count }, { ttl });
  //
  //   return count;
  // }
  //
  // async function isAttemptLimitReached(
  //   key: string,
  //   limit: number,
  // ): Promise<boolean> {
  //   const record = await storage.get<AttemptRecord>(key);
  //
  //   return (record?.count ?? 0) >= limit;
  // }
  //
  // return {
  //   handler() {
  //     return hono;
  //   },
  //   issue,
  //   refresh,
  //   revoke,
  //   verify,
  // };

  return hono;
}
