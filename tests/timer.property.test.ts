import fc from "fast-check";
import { describe, it } from "vitest";
import { formatDuration } from "../src/activity.js";
import {
  BUILT_IN_MODES,
  formatCountdown,
  progress,
  remainingMs,
  type TimerState,
} from "../src/timer.js";

const modeIds = fc.oneof(
  fc.constantFrom(...Object.keys(BUILT_IN_MODES).map(Number)),
  fc.integer({ min: 100, max: 1000 }),
);

const timerState = fc.record({
  isRunning: fc.boolean(),
  isBreak: fc.boolean(),
  timerModeId: modeIds,
  phaseEndsAt: fc.oneof(
    fc.constant(null),
    fc
      .date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true })
      .map((d) => d.toISOString()),
    fc.string(),
  ),
}) satisfies fc.Arbitrary<TimerState>;

const instant = fc.integer({ min: 946_684_800_000, max: 4_102_444_800_000 });

describe("timer (property-based)", () => {
  it("remainingMs is never negative and never reported for a stopped timer", () => {
    fc.assert(
      fc.property(timerState, instant, (state, now) => {
        const remaining = remainingMs(state, now);
        if (!state.isRunning) return remaining === undefined;
        return remaining === undefined || (remaining >= 0 && Number.isFinite(remaining));
      }),
    );
  });

  it("progress is always within [0, 1] when it is reported", () => {
    fc.assert(
      fc.property(timerState, instant, (state, now) => {
        const p = progress(state, now);
        return p === undefined || (p >= 0 && p <= 1);
      }),
    );
  });

  it("formatCountdown renders m:ss with seconds below 60 and inverts to the floored second count", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 10_000_000_000 }), (ms) => {
        const match = /^(\d+):(\d{2})$/.exec(formatCountdown(ms));
        if (!match) return false;
        const seconds = Number(match[2]);
        return (
          seconds < 60 && Number(match[1]) * 60 + seconds === Math.floor(Math.max(0, ms) / 1000)
        );
      }),
    );
  });

  it("formatDuration is monotonic in the minute count it displays", () => {
    const minutesOf = (text: string): number => {
      const m = /^(?:(\d+) h )?(\d+) min$/.exec(text);
      if (!m) throw new Error(`unexpected format: ${text}`);
      return Number(m[1] ?? 0) * 60 + Number(m[2]);
    };
    fc.assert(
      fc.property(fc.nat({ max: 1e11 }), fc.nat({ max: 1e11 }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return minutesOf(formatDuration(lo)) <= minutesOf(formatDuration(hi));
      }),
    );
  });
});
