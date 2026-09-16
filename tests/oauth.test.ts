import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_PORTS,
  buildConnectUrl,
  newPkcePair,
  newStateToken,
  parseCallback,
  redirectUriFor,
  statesMatch,
  trimBase,
} from "../src/oauth.js";

describe("PKCE", () => {
  it("produces a challenge that is the unpadded base64url SHA-256 of the verifier", () => {
    const { verifier, challenge } = newPkcePair();
    const expected = createHash("sha256").update(verifier, "ascii").digest("base64url");
    expect(challenge).toBe(expected);
    expect(challenge).not.toContain("=");
  });

  it("uses only unreserved characters, which is what the server validates", () => {
    for (let i = 0; i < 50; i++) {
      expect(newPkcePair().verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it("never repeats a verifier", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newPkcePair().verifier));
    expect(seen.size).toBe(200);
  });
});

describe("state comparison", () => {
  it("accepts an exact match", () => {
    const token = newStateToken();
    expect(statesMatch(token, token)).toBe(true);
  });

  it("rejects a mismatch, a missing value and a length difference alike", () => {
    const token = newStateToken();
    expect(statesMatch(newStateToken(), token)).toBe(false);
    expect(statesMatch(undefined, token)).toBe(false);
    // A length mismatch must return false rather than throw - timingSafeEqual throws on
    // differing lengths, and that throw would be the very leak the function exists to avoid.
    expect(statesMatch(`${token}extra`, token)).toBe(false);
    expect(statesMatch("", token)).toBe(false);
  });
});

describe("connect URL", () => {
  it("carries the four query parameters the server expects", () => {
    const url = new URL(
      buildConnectUrl("https://studylife.example.com", "studylife-vscode", "http://127.0.0.1:8775/callback", "st4te", "ch4llenge"),
    );
    expect(url.pathname).toBe("/connect/client/studylife-vscode");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8775/callback");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("code_challenge")).toBe("ch4llenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("does not produce a double slash when the instance URL has a trailing one", () => {
    const url = buildConnectUrl("https://studylife.example.com/", "c", "http://127.0.0.1:8775/callback", "s", "c");
    expect(url).not.toContain(".com//");
  });
});

describe("loopback redirect", () => {
  it("binds 127.0.0.1 rather than localhost, which may resolve to ::1", () => {
    for (const port of CANDIDATE_PORTS) {
      expect(redirectUriFor(port)).toBe(`http://127.0.0.1:${port}/callback`);
    }
  });

  it("uses ports that do not collide with studylife-cli's 8765-8768", () => {
    for (const port of CANDIDATE_PORTS) {
      expect(port).toBeGreaterThan(8768);
    }
  });
});

describe("callback parsing", () => {
  it("reads assertion and state", () => {
    expect(parseCallback("/callback?assertion=abc&state=xyz")).toEqual({
      assertion: "abc",
      state: "xyz",
    });
  });

  it("returns undefined fields rather than empty strings when they are absent", () => {
    expect(parseCallback("/callback")).toEqual({});
  });

  it("survives a callback carrying an error instead of an assertion", () => {
    expect(parseCallback("/callback?error=access_denied&state=xyz")).toEqual({ state: "xyz" });
  });
});

describe("trimBase", () => {
  it("removes any number of trailing slashes", () => {
    expect(trimBase("https://x.example.com///")).toBe("https://x.example.com");
    expect(trimBase("https://x.example.com")).toBe("https://x.example.com");
  });
});
