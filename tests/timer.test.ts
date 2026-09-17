import { describe, expect, it } from "vitest";
import {
  type TimerState,
  canChangeMode,
  durationMinutes,
  formatCountdown,
  modeChoices,
  modeName,
  phaseOf,
  progress,
  remainingMs,
  transition,
} from "../src/timer.js";

const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const MIN = 60_000;

function running(overrides: Partial<TimerState> = {}): TimerState {
  return {
    isRunning: true,
    isBreak: false,
    currentRound: 2,
    timerModeId: 1, // Pomodoro Classic, 25/5
    sessionId: 42,
    phaseEndsAt: new Date(NOW + 10 * MIN).toISOString(),
    ...overrides,
  };
}

describe("phase", () => {
  it("distinguishes stopped, focus and break", () => {
    expect(phaseOf(undefined)).toBe("stopped");
    expect(phaseOf({ isRunning: false })).toBe("stopped");
    expect(phaseOf(running())).toBe("focus");
    expect(phaseOf(running({ isBreak: true }))).toBe("break");
  });
});

describe("remaining time", () => {
  it("counts down to phaseEndsAt", () => {
    expect(remainingMs(running(), NOW)).toBe(10 * MIN);
  });

  it("clamps at zero rather than going negative once the phase has passed", () => {
    expect(remainingMs(running(), NOW + 30 * MIN)).toBe(0);
  });

  it("is undefined when nothing runs or the timestamp is unusable", () => {
    expect(remainingMs({ isRunning: false }, NOW)).toBeUndefined();
    expect(remainingMs(running({ phaseEndsAt: null }), NOW)).toBeUndefined();
    expect(remainingMs(running({ phaseEndsAt: "not a date" }), NOW)).toBeUndefined();
  });
});

describe("progress", () => {
  it("is the fraction of the phase already elapsed", () => {
    // Pomodoro focus is 25 min; 10 remain, so 15 of 25 are done.
    expect(progress(running(), NOW)).toBeCloseTo(15 / 25, 5);
  });

  it("uses the break length during a break, not the focus length", () => {
    const state = running({ isBreak: true, phaseEndsAt: new Date(NOW + 1 * MIN).toISOString() });
    expect(progress(state, NOW)).toBeCloseTo(4 / 5, 5);
  });

  it("is undefined for a custom mode instead of inventing a total", () => {
    // Custom modes live in the user's settings, which this extension cannot read - the bar has
    // to go indeterminate rather than claim a fraction it does not know.
    expect(progress(running({ timerModeId: 100 }), NOW)).toBeUndefined();
    expect(durationMinutes(running({ timerModeId: 100 }))).toBeUndefined();
    expect(modeName(running({ timerModeId: 100 }))).toBeUndefined();
  });

  it("is undefined when stopped", () => {
    expect(progress({ isRunning: false }, NOW)).toBeUndefined();
  });

  it("never leaves 0..1 even if the clock jumped", () => {
    expect(progress(running(), NOW + 60 * MIN)).toBe(1);
  });
});

describe("countdown formatting", () => {
  it("renders minutes:seconds with padding", () => {
    expect(formatCountdown(24 * MIN + 13_000)).toBe("24:13");
    expect(formatCountdown(9_000)).toBe("0:09");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});

describe("transitions", () => {
  // The wire shape has no "paused" flag - getting this wrong is silent, because the server drops
  // unknown JSON properties without complaint.
  it("pause stops the clock but keeps the session, round and break flag", () => {
    const next = transition(running({ isBreak: true, currentRound: 3 }), "pause", { now: NOW });
    expect(next.isRunning).toBe(false);
    expect(next.phaseEndsAt).toBeNull();
    expect(next.sessionId).toBe(42);
    expect(next.currentRound).toBe(3);
    expect(next.isBreak).toBe(true);
    expect("isPaused" in next).toBe(false);
  });

  it("stop ends the session and resets to round one", () => {
    const next = transition(running({ isBreak: true, currentRound: 3 }), "stop", { now: NOW });
    expect(next.isRunning).toBe(false);
    expect(next.phaseEndsAt).toBeNull();
    expect(next.sessionId).toBeNull();
    expect(next.currentRound).toBe(1);
    expect(next.isBreak).toBe(false);
  });

  it("start resumes the remainder of a paused phase rather than restarting it", () => {
    // A paused state carries no phaseEndsAt, so there is no remainder to resume: a full phase.
    const paused = transition(running(), "pause", { now: NOW });
    const resumed = transition(paused, "start", { now: NOW });
    expect(Date.parse(resumed.phaseEndsAt as string) - NOW).toBe(25 * MIN);
  });

  it("start from a still-running state keeps the existing remainder", () => {
    const next = transition(running(), "start", { now: NOW });
    expect(Date.parse(next.phaseEndsAt as string) - NOW).toBe(10 * MIN);
  });

  it("start falls back to 25 minutes when the mode is unknown", () => {
    const next = transition({ isRunning: false, timerModeId: 100 }, "start", { now: NOW });
    expect(Date.parse(next.phaseEndsAt as string) - NOW).toBe(25 * MIN);
  });

  it("attaches a course only on start", () => {
    expect(transition(undefined, "start", { now: NOW, courseId: 7 }).courseId).toBe(7);
    // Pause and stop must never carry one: re-attributing a running session's time silently
    // would corrupt the history the grade correlations are computed from.
    expect(transition(running(), "pause", { now: NOW, courseId: 7 }).courseId).toBeUndefined();
    expect(transition(running(), "stop", { now: NOW, courseId: 7 }).courseId).toBeUndefined();
  });

  it("always sends clientNow so the server can translate the deadline for other devices", () => {
    expect(transition(undefined, "start", { now: NOW }).clientNow).toBe(
      new Date(NOW).toISOString(),
    );
  });
});

describe("resuming after a pause", () => {
  // The wire shape cannot carry the remainder: pausing sets phaseEndsAt to null, and StudyLife's
  // own client keeps it in a private field it never sends. Without resumeMs, pause was
  // indistinguishable from stopping the clock and starting the phase over.
  it("restarts the phase from the remembered remainder, not from the top", () => {
    const paused = transition(running(), "pause", { now: NOW });
    const resumed = transition(paused, "start", { now: NOW, resumeMs: 10 * MIN });
    expect(Date.parse(resumed.phaseEndsAt as string) - NOW).toBe(10 * MIN);
  });

  it("prefers a live phase over a stale remembered remainder", () => {
    // Started elsewhere while this window still held an old pause value.
    const resumed = transition(running(), "start", { now: NOW, resumeMs: 3 * MIN });
    expect(Date.parse(resumed.phaseEndsAt as string) - NOW).toBe(10 * MIN);
  });

  it("falls back to a full phase when the remainder is absent or used up", () => {
    const paused = transition(running(), "pause", { now: NOW });
    expect(Date.parse(transition(paused, "start", { now: NOW }).phaseEndsAt as string) - NOW).toBe(
      25 * MIN,
    );
    expect(
      Date.parse(transition(paused, "start", { now: NOW, resumeMs: 0 }).phaseEndsAt as string) -
        NOW,
    ).toBe(25 * MIN);
  });
});

describe("mode selection", () => {
  it("offers the nine built-in presets with their lengths", () => {
    const choices = modeChoices(running());
    expect(choices).toHaveLength(9);
    expect(choices.find((c) => c.id === 1)).toMatchObject({
      name: "Pomodoro Classic",
      detail: "25 min focus / 5 min break",
      current: true,
    });
    expect(choices.find((c) => c.id === 2)?.detail).toBe("52 min focus / 17 min break");
  });

  it("marks nothing as current for a custom mode instead of guessing", () => {
    // Custom modes live in the user's settings, which this extension cannot read.
    expect(modeChoices(running({ timerModeId: 100 })).some((c) => c.current)).toBe(false);
  });

  it("allows a change only while stopped", () => {
    expect(canChangeMode(undefined)).toBe(true);
    expect(canChangeMode({ isRunning: false })).toBe(true);
    // Switching mid-phase would leave the countdown measured against a length that no longer
    // applies.
    expect(canChangeMode(running())).toBe(false);
  });

  it("applies a chosen mode on start", () => {
    expect(transition(undefined, "start", { now: NOW, modeId: 3 }).timerModeId).toBe(3);
    // 90 min focus for Ultradian Rhythm, not the 25 of the default.
    expect(
      Date.parse(transition(undefined, "start", { now: NOW, modeId: 3 }).phaseEndsAt as string) -
        NOW,
    ).toBe(90 * MIN);
  });

  it("keeps the existing mode when none is chosen", () => {
    expect(transition(running({ timerModeId: 7 }), "pause", { now: NOW }).timerModeId).toBe(7);
  });
});
