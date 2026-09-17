// The vscode/socket half of the login: binds a loopback listener, sends the user to the browser,
// waits for the redirect, and exchanges the one-time assertion for this installation's API key.
// The shapes it speaks are in oauth.ts and mirror studylife-cli's login.py.
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import * as vscode from "vscode";
import {
  CALLBACK_TIMEOUT_MS,
  CANDIDATE_PORTS,
  DEFAULT_CLIENT_ID,
  buildConnectUrl,
  newPkcePair,
  newStateToken,
  parseCallback,
  redirectUriFor,
  statesMatch,
  trimBase,
} from "./oauth.js";

const SECRET_KEY = "studylife.apiKey";

export class LoginError extends Error {}

/** The API key lives in the editor's secret storage, never in settings - settings sync would
 *  otherwise carry it to every machine the user signs in on. */
export async function readApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get(SECRET_KEY);
}

export async function storeApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
  await context.secrets.store(SECRET_KEY, apiKey);
}

export async function clearApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SECRET_KEY);
}

interface CallbackResult {
  assertion?: string;
  state?: string;
}

interface Listener {
  port: number;
  waitForCallback(timeoutMs: number): Promise<CallbackResult | undefined>;
  close(): void;
}

/** Binds the first free candidate port. See CANDIDATE_PORTS for why the list is fixed. Exported
 *  for the port-fallback tests - runLogin() cannot exercise it directly since the callback state
 *  it generates internally never leaves the function. */
export async function bindFirstFreePort(): Promise<Listener> {
  for (const port of CANDIDATE_PORTS) {
    const listener = await tryBind(port);
    if (listener) return listener;
  }
  throw new LoginError(
    `None of the loopback ports ${CANDIDATE_PORTS.join(", ")} are free. Close whatever is using ` +
      "them and run the connect command again.",
  );
}

export function tryBind(port: number): Promise<Listener | undefined> {
  return new Promise((resolve) => {
    let settle: ((result: CallbackResult) => void) | undefined;
    const received = new Promise<CallbackResult>((r) => (settle = r));

    const server: Server = createServer((req, res) => {
      const params = parseCallback(req.url ?? "/");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><meta charset=utf-8><title>StudyLife</title>" +
          '<body style="font-family:system-ui;padding:3rem;text-align:center">' +
          "<h1>Connected</h1><p>You can close this tab and go back to your editor.</p>",
      );
      settle?.(params);
    });

    server.once("error", () => resolve(undefined));
    server.listen(port, "127.0.0.1", () => {
      const bound = (server.address() as AddressInfo).port;
      resolve({
        port: bound,
        waitForCallback: (timeoutMs) =>
          Promise.race([
            received,
            new Promise<undefined>((r) => setTimeout(() => r(undefined), timeoutMs)),
          ]),
        close: () => server.close(),
      });
    });
  });
}

/**
 * Drives one full browser login and returns the freshly issued API key. The assertion is
 * single-use and only redeemable together with the PKCE verifier this process generated, so a
 * copy of the redirect URL on its own (browser history, a proxy log) is worthless to anyone else.
 */
export async function runLogin(
  instanceUrl: string,
  clientId: string = DEFAULT_CLIENT_ID,
): Promise<string> {
  const baseUrl = trimBase(instanceUrl);
  const state = newStateToken();
  const { verifier, challenge } = newPkcePair();
  const listener = await bindFirstFreePort();

  try {
    const redirectUri = redirectUriFor(listener.port);
    const connectUrl = buildConnectUrl(baseUrl, clientId, redirectUri, state, challenge);
    await vscode.env.openExternal(vscode.Uri.parse(connectUrl));

    const result = await listener.waitForCallback(CALLBACK_TIMEOUT_MS);
    if (!result) {
      throw new LoginError(
        "Timed out waiting for StudyLife to redirect back. Either the approval was not finished " +
          `in the browser, or "${clientId}" is not registered on that instance yet - see the ` +
          "README for how to register it once via studylife-developers.",
      );
    }
    if (!statesMatch(result.state, state)) {
      throw new LoginError(
        "Rejected the login callback: its state did not match what this window sent. Run the " +
          "connect command again.",
      );
    }
    if (!result.assertion) {
      throw new LoginError(
        "StudyLife's callback carried no assertion - the connection was denied.",
      );
    }
    return await exchangeAssertion(baseUrl, clientId, result.assertion, verifier);
  } finally {
    listener.close();
  }
}

/** Server-to-server redemption of the assertion. Deliberately sends no X-Api-Key: the endpoint is
 *  anonymous by design, the assertion itself is the one-time credential. Exported so its error
 *  branches are directly testable without driving a whole runLogin() round trip. */
export async function exchangeAssertion(
  baseUrl: string,
  clientId: string,
  assertion: string,
  codeVerifier: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/assertion-exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, assertion, codeVerifier }),
  });
  if (!response.ok) {
    throw new LoginError(
      `StudyLife refused the assertion exchange (${response.status}). The approval may have ` +
        "expired - run the connect command again.",
    );
  }
  const body = (await response.json()) as { apiKey?: string };
  if (!body.apiKey) throw new LoginError("StudyLife's exchange response carried no API key.");
  return body.apiKey;
}
