import { describe, expect, it } from "vitest";
import {
  MINIMUM_LOGGABLE_MS,
  type TimerRun,
  decide,
  placeholderCourseName,
} from "../src/runLog.js";

const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const MIN = 60_000;

function run(overrides: Partial<TimerRun> = {}): TimerRun {
  return { courseId: 7, startedAt: NOW - 45 * MIN, sessionId: null, ...overrides };
}

describe("decide", () => {
  it("logs a finished run that nothing was planned for", () => {
    const d = decide(run(), null, NOW);
    expect(d).toEqual({
      log: true,
      courseId: 7,
      startedAt: NOW - 45 * MIN,
      endedAt: NOW,
    });
  });

  it("does not log when a planned session was attached", () => {
    // StudyLife already accounts for that time through the planned session; a second row would
    // double-count it in exactly the history the grade correlations are computed from.
    expect(decide(run(), 123, NOW)).toEqual({ log: false, reason: "planned" });
  });

  it("does not log when this window never started a run", () => {
    // The timer may have been started on another device - there is no course and no start time
    // to book, and guessing one would be worse than booking nothing.
    expect(decide(undefined, null, NOW)).toEqual({ log: false, reason: "no-run" });
  });

  it("logs a deliberate one-minute block - short is not the same as accidental", () => {
    // The threshold started at a minute and silently swallowed exactly this case.
    expect(decide(run({ startedAt: NOW - 60_000 }), null, NOW).log).toBe(true);
    expect(decide(run({ startedAt: NOW - 45_000 }), null, NOW).log).toBe(true);
    expect(decide(run({ startedAt: NOW - 11_000 }), null, NOW).log).toBe(true);
  });

  it("does not log a run too short to be real", () => {
    const d = decide(run({ startedAt: NOW - 4_000 }), null, NOW);
    expect(d).toEqual({ log: false, reason: "too-short" });
  });

  it("logs a run exactly at the threshold", () => {
    expect(decide(run({ startedAt: NOW - MINIMUM_LOGGABLE_MS }), null, NOW).log).toBe(true);
  });

  it("treats undefined and null planned sessions the same", () => {
    expect(decide(run(), undefined, NOW).log).toBe(true);
    expect(decide(run(), null, NOW).log).toBe(true);
  });

  it("checks the planned session before the length, so a short planned run is not mislabelled", () => {
    expect(decide(run({ startedAt: NOW - 5_000 }), 123, NOW)).toEqual({
      log: false,
      reason: "planned",
    });
  });
});

describe("placeholderCourseName", () => {
  // The server rejects POST /api/sessions with 400 ("CourseName must not be empty.") whenever
  // this comes back blank - it used to always be blank, because NewSession never carried the
  // field at all, so every createSession() call failed unconditionally. The server ignores this
  // value's actual content (it re-derives the real name from courseId and overwrites it), so
  // correctness here means exactly one thing: never empty.
  it("uses the known name when one is available", () => {
    expect(placeholderCourseName(7, "Betriebssysteme")).toBe("Betriebssysteme");
  });

  it("falls back to the stringified courseId when nothing is known", () => {
    expect(placeholderCourseName(42, undefined)).toBe("42");
  });

  it("falls back when the known name is empty or whitespace-only", () => {
    expect(placeholderCourseName(42, "")).toBe("42");
    expect(placeholderCourseName(42, "   ")).toBe("42");
  });

  it("never returns an empty string", () => {
    expect(placeholderCourseName(1, undefined).length).toBeGreaterThan(0);
    expect(placeholderCourseName(1, "").length).toBeGreaterThan(0);
  });
});
