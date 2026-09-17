import type { ExtensionContext, SecretStorage } from "vscode";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LoginError,
  bindFirstFreePort,
  clearApiKey,
  exchangeAssertion,
  readApiKey,
  storeApiKey,
  tryBind,
} from "../src/auth.js";
import { CANDIDATE_PORTS } from "../src/oauth.js";

function fakeContext(): ExtensionContext {
  const store = new Map<string, string>();
  // Only get/store/delete are used by auth.ts - the real SecretStorage also has onDidChange,
  // which nothing under test needs.
  const secrets = {
    get: async (key: string) => store.get(key),
    store: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as SecretStorage;
  return { secrets } as ExtensionContext;
}

describe("secret storage", () => {
  it("round-trips the API key and clears it again", async () => {
    const context = fakeContext();
    expect(await readApiKey(context)).toBeUndefined();
    await storeApiKey(context, "sk-test");
    expect(await readApiKey(context)).toBe("sk-test");
    await clearApiKey(context);
    expect(await readApiKey(context)).toBeUndefined();
  });
});

describe("tryBind", () => {
  it("binds a free candidate port and closes cleanly", async () => {
    const listener = await tryBind(CANDIDATE_PORTS[0]);
    expect(listener?.port).toBe(CANDIDATE_PORTS[0]);
    listener?.close();
  });

  it("resolves undefined instead of throwing when the port is already taken", async () => {
    const first = await tryBind(CANDIDATE_PORTS[0]);
    expect(first).toBeDefined();
    try {
      const second = await tryBind(CANDIDATE_PORTS[0]);
      expect(second).toBeUndefined();
    } finally {
      first?.close();
    }
  });
});

describe("bindFirstFreePort", () => {
  it("skips ports that are already taken and binds the next free one", async () => {
    const busy = await tryBind(CANDIDATE_PORTS[0]);
    try {
      const listener = await bindFirstFreePort();
      try {
        expect(listener.port).toBe(CANDIDATE_PORTS[1]);
      } finally {
        listener.close();
      }
    } finally {
      busy?.close();
    }
  });

  it("throws a LoginError naming every candidate port once all of them are taken", async () => {
    const busy = await Promise.all(CANDIDATE_PORTS.map((port) => tryBind(port)));
    try {
      await expect(bindFirstFreePort()).rejects.toThrow(LoginError);
      await expect(bindFirstFreePort()).rejects.toThrow(String(CANDIDATE_PORTS[0]));
    } finally {
      for (const listener of busy) listener?.close();
    }
  });
});

describe("Listener.waitForCallback", () => {
  it("resolves undefined once the timeout elapses with no callback", async () => {
    const listener = await tryBind(CANDIDATE_PORTS[0]);
    try {
      const result = await listener?.waitForCallback(30);
      expect(result).toBeUndefined();
    } finally {
      listener?.close();
    }
  });

  it("resolves with the assertion and state once the redirect arrives", async () => {
    const listener = await tryBind(CANDIDATE_PORTS[0]);
    try {
      const waiting = listener?.waitForCallback(5000);
      const response = await fetch(
        `http://127.0.0.1:${listener?.port}/callback?assertion=abc&state=xyz`,
      );
      expect(response.status).toBe(200);
      await expect(waiting).resolves.toEqual({ assertion: "abc", state: "xyz" });
    } finally {
      listener?.close();
    }
  });
});

describe("exchangeAssertion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the freshly issued API key on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ apiKey: "sk-live" }), { status: 200 })),
    );
    const key = await exchangeAssertion(
      "https://studylife.example.com",
      "studylife-vscode",
      "assertion-value",
      "verifier-value",
    );
    expect(key).toBe("sk-live");
  });

  it("rejects with a LoginError when the server refuses the exchange", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 400 })),
    );
    await expect(
      exchangeAssertion("https://studylife.example.com", "studylife-vscode", "a", "v"),
    ).rejects.toThrow(LoginError);
  });

  it("rejects with a LoginError when the response carries no API key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    await expect(
      exchangeAssertion("https://studylife.example.com", "studylife-vscode", "a", "v"),
    ).rejects.toThrow(LoginError);
  });

  it("sends no X-Api-Key header - the assertion is the one-time credential", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ apiKey: "sk-live" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await exchangeAssertion("https://studylife.example.com", "studylife-vscode", "a", "v");
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain("X-Api-Key");
  });
});
