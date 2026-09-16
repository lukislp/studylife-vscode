// Pure half of the login round trip: no vscode and no sockets in here, so the parts that are
// easy to get subtly wrong (PKCE shape, state comparison, callback parsing) are unit-testable.
//
// Ported from studylife-cli's login.py, which is itself the generic-flow port of studylife-mcp's.
// Keep the wire shapes identical to that reference - the server validates them strictly.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The loopback ports this client may bind, in order. Deliberately a FIXED list, not an
 * OS-assigned random port: the generic dynamic-client flow validates redirect_uri by EXACT match
 * against the client's registered AllowedRedirectUris, so a random port could never match. These
 * four are registered once for "studylife-vscode" via studylife-developers, and differ from
 * studylife-cli's 8765-8768 so both can be logged in at the same time.
 */
export const CANDIDATE_PORTS = [8775, 8776, 8777, 8778] as const;

export const DEFAULT_CLIENT_ID = "studylife-vscode";
export const CALLBACK_TIMEOUT_MS = 300_000;

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/**
 * (verifier, challenge) as the server's S256 validation expects: an unreserved-character
 * verifier and the unpadded base64url SHA-256 of it.
 */
export function newPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge };
}

export function newStateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Constant-time state comparison. Length is compared first because timingSafeEqual throws on a
 * length mismatch - that throw would itself be the leak it is meant to avoid.
 */
export function statesMatch(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function redirectUriFor(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}

export function buildConnectUrl(
  baseUrl: string,
  clientId: string,
  redirectUri: string,
  state: string,
  challenge: string,
): string {
  const query = new URLSearchParams({
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${trimBase(baseUrl)}/connect/client/${encodeURIComponent(clientId)}?${query}`;
}

/** Strips a trailing slash so callers can concatenate paths without producing "//". */
export function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export interface CallbackParams {
  assertion?: string;
  state?: string;
}

/** Reads the assertion/state out of the callback request's query string. */
export function parseCallback(requestUrl: string): CallbackParams {
  const query = new URL(requestUrl, "http://127.0.0.1").searchParams;
  const result: CallbackParams = {};
  const assertion = query.get("assertion");
  const state = query.get("state");
  if (assertion !== null) result.assertion = assertion;
  if (state !== null) result.state = state;
  return result;
}
