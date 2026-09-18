import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type SessionRecord, StudyLifeApi, sumHoursOn } from "../src/api.js";

const NOON = new Date(2026, 8, 16, 12, 0, 0).getTime();
const H = 3_600_000;

function at(hour: number, minutes = 0): string {
  return new Date(2026, 8, 16, hour, minutes, 0).toISOString();
}

describe("sumHoursOn", () => {
  // MetricsHoursDto carries week, month and total - but no today, so this is where the daily
  // figure actually comes from.
  it("sums sessions that happened today", () => {
    const sessions: SessionRecord[] = [
      { startTime: at(8), endTime: at(9, 30) },
      { startTime: at(10), endTime: at(10, 45) },
    ];
    expect(sumHoursOn(sessions, NOON)).toBeCloseTo(2.25, 5);
  });

  it("ignores sessions from another day", () => {
    const yesterday = new Date(2026, 8, 15, 10, 0, 0).toISOString();
    const yesterdayEnd = new Date(2026, 8, 15, 12, 0, 0).toISOString();
    expect(sumHoursOn([{ startTime: yesterday, endTime: yesterdayEnd }], NOON)).toBe(0);
  });

  it("counts only today's part of a session spanning midnight", () => {
    const sessions: SessionRecord[] = [
      { startTime: new Date(2026, 8, 15, 23, 0, 0).toISOString(), endTime: at(1) },
    ];
    expect(sumHoursOn(sessions, NOON) * H).toBeCloseTo(1 * H, 0);
  });

  it("skips malformed entries instead of throwing", () => {
    const sessions: SessionRecord[] = [
      { startTime: at(8), endTime: at(9) },
      { startTime: "nonsense", endTime: at(9) },
      { startTime: at(8) },
      {},
      // End before start - a corrupt row must not subtract from the total.
      { startTime: at(11), endTime: at(10) },
    ];
    expect(sumHoursOn(sessions, NOON)).toBeCloseTo(1, 5);
  });

  it("returns zero for an empty list", () => {
    expect(sumHoursOn([], NOON)).toBe(0);
  });
});

describe("StudyLifeApi", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the API key and content-type headers, and returns the parsed body", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify([{ id: 1, name: "Algorithms" }]), { status: 200 }),
    );
    const api = new StudyLifeApi(
      "https://studylife.example.com",
      "sk-test",
      fetchImpl as unknown as typeof fetch,
    );
    const courses = await api.getCourses();
    expect(courses).toEqual([{ id: 1, name: "Algorithms" }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://studylife.example.com/api/courses");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("sk-test");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("strips a trailing slash from the base URL before concatenating a path", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    const api = new StudyLifeApi("https://x/", "k", fetchImpl as unknown as typeof fetch);
    await api.getCourses();
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://x/api/courses");
  });

  it("returns undefined for a 204 response instead of parsing a body", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const api = new StudyLifeApi("https://x", "k", fetchImpl as unknown as typeof fetch);
    await expect(
      api.createSession({
        courseId: 1,
        courseName: "Algorithms",
        startTime: "a",
        endTime: "b",
        timerModeId: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it("requests /api/sessions for getAllSessions - the Sessions.GetAll endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    const api = new StudyLifeApi("https://x", "k", fetchImpl as unknown as typeof fetch);
    await api.getAllSessions();
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://x/api/sessions");
  });

  it("sends courseName on createSession - the server rejects a missing/empty one with 400", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const api = new StudyLifeApi("https://x", "k", fetchImpl as unknown as typeof fetch);
    await api.createSession({
      courseId: 7,
      courseName: "Betriebssysteme",
      startTime: "a",
      endTime: "b",
      timerModeId: 1,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.courseName).toBe("Betriebssysteme");
  });

  it("adds a scope hint to a 403 and does not retry it", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 403 }));
    const api = new StudyLifeApi("https://x", "k", fetchImpl as unknown as typeof fetch);
    await expect(api.getCourses()).rejects.toThrow(/not granted that permission/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a plain 404 without a hint and without retrying", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    const api = new StudyLifeApi("https://x", "k", fetchImpl as unknown as typeof fetch);
    const error = await api.getCourses().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).not.toMatch(/not granted/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries once on a 5xx response and returns the retry's result", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 1, name: "Algorithms" }]), { status: 200 }),
      );
    const api = new StudyLifeApi("https://x", "k", fetchImpl as unknown as typeof fetch);
    const promise = api.getCourses();
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toEqual([{ id: 1, name: "Algorithms" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries once after a network-level failure (no response at all)", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    const api = new StudyLifeApi("https://x", "k", fetchImpl as unknown as typeof fetch);
    const promise = api.getCourses();
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after two 5xx responses in a row instead of retrying forever", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));
    const api = new StudyLifeApi("https://x", "k", fetchImpl as unknown as typeof fetch);
    const promise = api.getCourses();
    const assertion = expect(promise).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("times out a hung request, retries once, and eventually reports the timeout", async () => {
    vi.useFakeTimers();
    const hangingFetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("This operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const api = new StudyLifeApi("https://x", "k", hangingFetch as unknown as typeof fetch);
    const promise = api.getCourses();
    const assertion = expect(promise).rejects.toThrow(/timed out after 15s/);
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    expect(hangingFetch).toHaveBeenCalledTimes(2);
  });
});
