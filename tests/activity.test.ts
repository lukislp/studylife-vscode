import { describe, expect, it } from "vitest";
import { ActivityTracker, durationMs, formatDuration, formatHours } from "../src/activity.js";

const MIN = 60_000;
const options = { idleMs: 5 * MIN, minimumMs: 20 * MIN };

describe("ActivityTracker", () => {
  it("opens a stretch on the first activity and reports nothing finished yet", () => {
    const tracker = new ActivityTracker(options);
    expect(tracker.noteActivity(0)).toBeUndefined();
    expect(tracker.peek()).toEqual({ startedAt: 0, lastActivityAt: 0 });
  });

  it("extends the open stretch while edits keep arriving inside the idle window", () => {
    const tracker = new ActivityTracker(options);
    tracker.noteActivity(0);
    tracker.noteActivity(4 * MIN);
    tracker.noteActivity(8 * MIN);
    expect(tracker.peek()).toEqual({ startedAt: 0, lastActivityAt: 8 * MIN });
  });

  it("closes the stretch when the gap exceeds the idle window and starts a fresh one", () => {
    const tracker = new ActivityTracker(options);
    tracker.noteActivity(0);
    tracker.noteActivity(3 * MIN); // inside the idle window, so this extends rather than closes
    const finished = tracker.noteActivity(30 * MIN);
    expect(finished).toEqual({ startedAt: 0, lastActivityAt: 3 * MIN });
    expect(tracker.peek()).toEqual({ startedAt: 30 * MIN, lastActivityAt: 30 * MIN });
  });

  it("treats a gap exactly equal to the idle window as still the same stretch", () => {
    const tracker = new ActivityTracker(options);
    tracker.noteActivity(0);
    expect(tracker.noteActivity(5 * MIN)).toBeUndefined();
  });

  it("offers a long stretch and drops a short one", () => {
    const tracker = new ActivityTracker(options);
    expect(tracker.isWorthOffering({ startedAt: 0, lastActivityAt: 25 * MIN })).toBe(true);
    expect(tracker.isWorthOffering({ startedAt: 0, lastActivityAt: 19 * MIN })).toBe(false);
    // Exactly at the threshold counts as worth offering.
    expect(tracker.isWorthOffering({ startedAt: 0, lastActivityAt: 20 * MIN })).toBe(true);
  });

  it("hands back the open stretch on flush and forgets it, so it is never offered twice", () => {
    const tracker = new ActivityTracker(options);
    tracker.noteActivity(0);
    tracker.noteActivity(4 * MIN); // inside the idle window, so the stretch stays open
    expect(tracker.flush()).toEqual({ startedAt: 0, lastActivityAt: 4 * MIN });
    expect(tracker.flush()).toBeUndefined();
    expect(tracker.peek()).toBeUndefined();
  });
});

describe("durationMs", () => {
  it("never goes negative even if clocks move backwards", () => {
    expect(durationMs({ startedAt: 10 * MIN, lastActivityAt: 0 })).toBe(0);
  });
});

describe("formatDuration", () => {
  it("renders hours and minutes, or minutes alone", () => {
    expect(formatDuration(134 * MIN)).toBe("2 h 14 min");
    expect(formatDuration(47 * MIN)).toBe("47 min");
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(59_999)).toBe("0 min");
    expect(formatDuration(120 * MIN)).toBe("2 h 0 min");
  });

  it("clamps a negative input instead of rendering nonsense", () => {
    expect(formatDuration(-5000)).toBe("0 min");
  });
});

describe("formatHours", () => {
  it("renders the decimal hours the metrics API returns", () => {
    expect(formatHours(2.25)).toBe("2 h 15 min");
    expect(formatHours(0)).toBe("0 min");
  });

  it("shows a dash rather than NaN when the field is absent", () => {
    expect(formatHours(undefined)).toBe("-");
    expect(formatHours(Number.NaN)).toBe("-");
  });
});
