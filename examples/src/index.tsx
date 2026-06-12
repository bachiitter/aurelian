import { serve } from "@hono/node-server";
import { CodeProvider } from "aurelian/providers/code";
import { google } from "aurelian/providers/google";
import { PasswordProvider } from "aurelian/providers/password";
import { createAuth, defineProfiles } from "aurelian/server";
import { memoryStorage } from "aurelian/storage/memory";
import { createServer } from "vite";
import { Hono } from "hono";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { z } from "zod";

const issuer = "http://localhost:3000/auth";
const clientOrigin = "http://localhost:5173";

const profiles = defineProfiles({
  user: z.object({
    id: z.string(),
  }),
});

const signingKeyPair = await generateKeyPair("RS256", { extractable: true });
const privateKey = await exportPKCS8(signingKeyPair.privateKey);
const publicKey = await exportSPKI(signingKeyPair.publicKey);
const passwords = new Map([["demo@example.com", "password"]]);

const auth = createAuth({
  resolve({ profile, response }) {
    if (response.provider === "google") {
      return profile("user", {
        id: getGoogleEmail(response.data),
      });
    }

    if (response.provider === "password") {
      return profile("user", {
        id: getPasswordEmail(response.data),
      });
    }

    if (response.provider === "code") {
      return profile("user", {
        id: getCodeEmail(response.data),
      });
    }

    throw new Error("provider_not_supported");
  },
  issuer,
  profiles,
  providers: {
    code: CodeProvider({
      async sendCode(claims, code) {
        console.info("Verification code", { code, email: claims.email });
      },
    }),
    google: google({
      clientID: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    password: PasswordProvider({
      async change({ currentPassword, email, newPassword }) {
        if (passwords.get(email) !== currentPassword) {
          return false;
        }

        passwords.set(email, newPassword);

        return true;
      },
      async login({ email, password }) {
        if (passwords.get(email) !== password) {
          return null;
        }

        return {
          email,
          emailVerified: true,
          id: email,
        };
      },
      async register({ email, password }) {
        if (passwords.has(email)) {
          return null;
        }

        passwords.set(email, password);

        return {
          email,
          emailVerified: true,
          id: email,
        };
      },
    }),
  },
  redirectURIs: [`${clientOrigin}/callback`],
  signing: {
    privateKey,
    publicKey,
  },
  storage: memoryStorage(),
  tokens: {
    access: {
      ttl: 60 * 60,
    },
    refresh: {
      ttl: 30 * 24 * 60 * 60,
    },
  },
  logger: true,
});

const app = new Hono();

app.route("/auth", auth.handler());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getGoogleEmail(identity: unknown): string {
  if (
    !isRecord(identity) ||
    typeof identity.email !== "string" ||
    identity.email_verified !== true
  ) {
    throw new Error("verified_email_required");
  }

  return identity.email;
}

function getPasswordEmail(identity: unknown): string {
  if (
    !isRecord(identity) ||
    typeof identity.email !== "string" ||
    identity.emailVerified !== true
  ) {
    throw new Error("verified_email_required");
  }

  return identity.email;
}

function getCodeEmail(identity: unknown): string {
  if (
    !isRecord(identity) ||
    typeof identity.email !== "string" ||
    identity.emailVerified !== true
  ) {
    throw new Error("verified_email_required");
  }

  return identity.email;
}

app.get("/", (c) => {
  return c.redirect(clientOrigin);
});

serve({
  fetch: app.fetch,
  port: 3000,
});

const vite = await createServer({
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});

await vite.listen();
vite.printUrls();
