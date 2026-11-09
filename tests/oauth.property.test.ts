import fc from "fast-check";
import { describe, it } from "vitest";
import {
  buildConnectUrl,
  parseCallback,
  redirectUriFor,
  statesMatch,
  trimBase,
} from "../src/oauth.js";

describe("oauth (property-based)", () => {
  it("trimBase never leaves a trailing slash and is idempotent", () => {
    fc.assert(
      fc.property(fc.string(), (base) => {
        const once = trimBase(base);
        return !once.endsWith("/") && trimBase(once) === once;
      }),
    );
  });

  it("parseCallback returns exactly the assertion and state it was given, however they are encoded", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (assertion, state) => {
        const query = new URLSearchParams({ assertion, state });
        const parsed = parseCallback(`/callback?${query}`);
        return parsed.assertion === assertion && parsed.state === state;
      }),
    );
  });

  it("parseCallback never throws on arbitrary query text and only reports known keys", () => {
    fc.assert(
      fc.property(fc.string(), (junk) => {
        const parsed = parseCallback(`/callback?${junk}`);
        return Object.keys(parsed).every((k) => k === "assertion" || k === "state");
      }),
    );
  });

  it("buildConnectUrl carries redirect_uri, state and challenge through a URL round trip", () => {
    fc.assert(
      fc.property(
        fc.webUrl({ withQueryParameters: false, withFragments: false }),
        fc.string({ minLength: 1 }),
        fc.string(),
        fc.string(),
        fc.integer({ min: 1, max: 65535 }),
        (base, clientId, state, challenge, port) => {
          const redirect = redirectUriFor(port);
          const url = new URL(buildConnectUrl(base, clientId, redirect, state, challenge));
          return (
            url.searchParams.get("redirect_uri") === redirect &&
            url.searchParams.get("state") === state &&
            url.searchParams.get("code_challenge") === challenge &&
            url.searchParams.get("code_challenge_method") === "S256"
          );
        },
      ),
    );
  });

  it("statesMatch is reflexive for non-empty strings and equals plain equality otherwise", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string(), (a, b) => {
        return statesMatch(a, a) && statesMatch(b, a) === (a === b);
      }),
    );
  });
});
