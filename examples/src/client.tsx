import { createClient } from "aurelian/client";
import { render } from "hono/jsx/dom";
import { useState } from "hono/jsx";

const issuer = "http://localhost:3000/auth";
const authClient = createClient({ issuer });

function App() {
  const [output, setOutput] = useState<unknown>({ ready: true });

  async function signInWithGoogle() {
    const authorization = await authClient.authorize({
      pkce: true,
      provider: "google",
      redirectURI: `${window.location.origin}/callback`,
    });

    localStorage.setItem(
      "aurelian.pkce",
      JSON.stringify(authorization.challenge),
    );
    localStorage.setItem("aurelian.state", authorization.state);
    window.location.href = authorization.url.toString();
  }

  async function signInWithPassword(event: Event) {
    event.preventDefault();

    const form = new FormData(event.currentTarget as HTMLFormElement);
    const response = await fetch(`${issuer}/password/callback`, {
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    await handleTokenResponse(response, setOutput);
  }

  async function sendCode(event: Event) {
    event.preventDefault();

    const form = new FormData(event.currentTarget as HTMLFormElement);
    const response = await fetch(`${issuer}/code/authorize`, {
      body: JSON.stringify({
        email: form.get("email"),
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    setOutput(await response.json());
  }

  async function verifyCode(event: Event) {
    event.preventDefault();

    const form = new FormData(event.currentTarget as HTMLFormElement);
    const response = await fetch(`${issuer}/code/callback`, {
      body: JSON.stringify({
        code: form.get("code"),
        email: form.get("email"),
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    await handleTokenResponse(response, setOutput);
  }

  async function verifyStoredToken() {
    const accessToken = localStorage.getItem("aurelian.accessToken");

    if (!accessToken) {
      setOutput({ error: "missing_access_token" });
      return;
    }

    setOutput(await authClient.verify(accessToken));
  }

  return (
    <main>
      <h1>Aurelian Client Example</h1>

      <section>
        <h2>Google OAuth + PKCE</h2>
        <button onClick={signInWithGoogle} type="button">
          Continue with Google
        </button>
      </section>

      <section>
        <h2>Password</h2>
        <form onSubmit={signInWithPassword}>
          <input name="email" type="email" value="demo@example.com" />
          <input name="password" type="password" value="password" />
          <button type="submit">Sign in</button>
        </form>
      </section>

      <section>
        <h2>Email Code</h2>
        <form onSubmit={sendCode}>
          <input name="email" type="email" value="demo@example.com" />
          <button type="submit">Send code</button>
        </form>
        <form onSubmit={verifyCode}>
          <input name="email" type="email" value="demo@example.com" />
          <input
            name="code"
            inputMode="numeric"
            placeholder="Code from server logs"
          />
          <button type="submit">Verify code</button>
        </form>
      </section>

      <section>
        <h2>Verify Token</h2>
        <button onClick={verifyStoredToken} type="button">
          Verify stored access token
        </button>
      </section>

      <pre>{JSON.stringify(output, null, 2)}</pre>
    </main>
  );
}

void handleCallback((value) => {
  renderApp();
  window.setTimeout(() => {
    const output = document.querySelector("pre");

    if (output) {
      output.textContent = JSON.stringify(value, null, 2);
    }
  });
});

if (window.location.pathname !== "/callback") {
  renderApp();
}

function renderApp(): void {
  const root = document.getElementById("root");

  if (!root) {
    return;
  }

  render(<App />, root);
}

async function handleCallback(write: (value: unknown) => void): Promise<void> {
  if (window.location.pathname !== "/callback") {
    return;
  }

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = localStorage.getItem("aurelian.state");
  const challenge = readPKCEChallenge();

  if (!code || !challenge || state !== expectedState) {
    write({ error: "invalid_callback" });
    return;
  }

  const tokens = await authClient.exchange({
    code,
    codeVerifier: challenge.verifier,
    redirectURI: `${window.location.origin}/callback`,
  });

  storeTokens(tokens);
  write(tokens);
}

async function handleTokenResponse(
  response: Response,
  write: (value: unknown) => void,
): Promise<void> {
  const json = await response.json();

  if (!response.ok) {
    write(json);
    return;
  }

  storeTokens(json);
  write(json);
}

function readPKCEChallenge(): { verifier: string } | null {
  const value = localStorage.getItem("aurelian.pkce");

  if (!value) {
    return null;
  }

  const parsed = JSON.parse(value) as unknown;

  if (!isRecord(parsed) || typeof parsed.verifier !== "string") {
    return null;
  }

  return { verifier: parsed.verifier };
}

function storeTokens(value: unknown): void {
  if (
    !isRecord(value) ||
    typeof value.accessToken !== "string" ||
    typeof value.refreshToken !== "string"
  ) {
    return;
  }

  localStorage.setItem("aurelian.accessToken", value.accessToken);
  localStorage.setItem("aurelian.refreshToken", value.refreshToken);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
