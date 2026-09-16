// Timer semantics, mirroring StudyLife's own TimerService so this extension produces states the
// web app and Home Assistant already understand.
//
// The wire shape has no "paused" flag. Pause and stop both push isRunning: false with
// phaseEndsAt: null; what separates them is whether the session survives. Getting this wrong is
// invisible in a green build - the server accepts unknown JSON properties and silently drops
// them - so it is kept here, in one place, under test.

/** The built-in presets (ids 1-9). Custom modes start at 100 and live in the user's settings,
 *  which this extension is not scoped to read - see durationMinutes. */
export const BUILT_IN_MODES: Record<number, { name: string; focus: number; break: number }> = {
  1: { name: "Pomodoro Classic", focus: 25, break: 5 },
  2: { name: "Flow State", focus: 52, break: 17 },
  3: { name: "Ultradian Rhythm", focus: 90, break: 20 },
  4: { name: "Claude Mode", focus: 40, break: 10 },
  5: { name: "Sprint Bursts", focus: 10, break: 3 },
  6: { name: "Micro Focus", focus: 5, break: 1 },
  7: { name: "Quick Burst", focus: 15, break: 3 },
  8: { name: "Deep Dive", focus: 120, break: 20 },
  9: { name: "Marathon Session", focus: 180, break: 30 },
};

export interface TimerState {
  sessionId?: number | null;
  isRunning: boolean;
  isBreak?: boolean;
  currentRound?: number;
  timerModeId?: number;
  /** Local-time ISO string, null whenever the timer is not running. */
  phaseEndsAt?: string | null;
  clientNow?: string;
  [key: string]: unknown;
}

export type Phase = "stopped" | "focus" | "break";

export function phaseOf(state: TimerState | undefined): Phase {
  if (!state?.isRunning) return "stopped";
  return state.isBreak ? "break" : "focus";
}

/**
 * Minutes the current phase lasts, or undefined for a custom mode. Custom modes (id >= 100) are
 * stored in the user's settings and this extension has no scope to read them - so the progress
 * bar degrades to showing only the remaining time rather than inventing a total.
 */
export function durationMinutes(state: TimerState | undefined): number | undefined {
  const mode = state?.timerModeId === undefined ? undefined : BUILT_IN_MODES[state.timerModeId];
  if (!mode) return undefined;
  return state?.isBreak ? mode.break : mode.focus;
}

export function modeName(state: TimerState | undefined): string | undefined {
  const id = state?.timerModeId;
  return id === undefined ? undefined : BUILT_IN_MODES[id]?.name;
}

/** Milliseconds until the phase ends, clamped at zero. undefined when nothing is running. */
export function remainingMs(state: TimerState | undefined, now: number): number | undefined {
  if (!state?.isRunning || !state.phaseEndsAt) return undefined;
  const ends = Date.parse(state.phaseEndsAt);
  if (Number.isNaN(ends)) return undefined;
  return Math.max(0, ends - now);
}

/**
 * How far through the phase we are, 0..1 - or undefined when it cannot be known honestly
 * (nothing running, or a custom mode whose length this extension cannot read). Callers render an
 * indeterminate bar in that case rather than a made-up fraction.
 */
export function progress(state: TimerState | undefined, now: number): number | undefined {
  const remaining = remainingMs(state, now);
  const minutes = durationMinutes(state);
  if (remaining === undefined || minutes === undefined || minutes <= 0) return undefined;
  const total = minutes * 60_000;
  return Math.min(1, Math.max(0, (total - remaining) / total));
}

/** "24:13" - the shape a countdown wants, unlike formatDuration's "24 min". */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export interface TransitionOptions {
  /** Only honoured on start; changing it mid-session would re-attribute time already spent. */
  courseId?: number;
  /**
   * Milliseconds left in the phase when it was paused, to resume instead of restarting.
   *
   * This has to be carried by the caller because the wire shape cannot hold it: pausing sets
   * phaseEndsAt to null, and StudyLife's own client keeps the remainder in memory
   * (TimerService.Pause writes it to a private _secondsLeft field that is never sent). Without
   * it, "pause" is indistinguishable from "stop the clock and start over" - which is exactly how
   * it behaved before this was threaded through.
   */
  resumeMs?: number;
  now: number;
}

/**
 * The next timer state for an action, built from the current one.
 *
 * start   - runs the remainder of the phase, or a fresh phase when nothing was pending
 * pause   - stops the clock but keeps the session, round and break flag
 * stop    - ends the session outright and resets to round one
 */
export function transition(
  current: TimerState | undefined,
  action: "start" | "pause" | "stop",
  options: TransitionOptions,
): TimerState {
  const base: TimerState = {
    sessionId: current?.sessionId ?? null,
    isRunning: false,
    isBreak: current?.isBreak ?? false,
    currentRound: current?.currentRound ?? 1,
    timerModeId: current?.timerModeId ?? 1,
    phaseEndsAt: null,
    clientNow: new Date(options.now).toISOString(),
  };

  if (action === "stop") {
    return { ...base, sessionId: null, isBreak: false, currentRound: 1 };
  }
  if (action === "pause") {
    return base;
  }

  // start: resume the live phase, then a remembered pause, and only then a full phase.
  const live = remainingMs(current, options.now);
  const resume = options.resumeMs !== undefined && options.resumeMs > 0 ? options.resumeMs : undefined;
  const minutes = durationMinutes(base);
  const durationMs = live && live > 0 ? live : (resume ?? (minutes ?? 25) * 60_000);
  return {
    ...base,
    isRunning: true,
    phaseEndsAt: new Date(options.now + durationMs).toISOString(),
    ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
  };
}
