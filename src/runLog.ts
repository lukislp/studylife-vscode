// Deciding whether a finished timer run should become a study session.
//
// Why this is needed at all: StudyLife's timer does not record time. The web app attaches it to a
// session the planner already created (Focus.razor: `Timer.LoadMode(mode, _activeSession?.Id)`),
// and the timer state itself carries neither a course nor a start time - TimerStateEntity has
// sessionId, isRunning, isBreak, currentRound, timerModeId and phaseEndsAt, and nothing else. So
// a session started from this extension, with nothing planned for that slot, would otherwise run
// its course and book nothing.
//
// The extension therefore remembers what it started, and on stop turns it into a session - unless
// a planned one was already attached, in which case StudyLife is already accounting for the time
// and a second row would double-count it.

/** What the extension recorded when it started a run. Persisted, because a run can outlive a
 *  window reload. */
export interface TimerRun {
  courseId: number;
  courseName?: string;
  startedAt: number;
  /** The planned session the timer was attached to when it started, if any. */
  sessionId?: number | null;
}

/** Shorter than this and a run is an accident - a mis-click, or a start immediately undone. */
export const MINIMUM_LOGGABLE_MS = 60_000;

export type Decision =
  | { log: true; courseId: number; startedAt: number; endedAt: number }
  | { log: false; reason: "no-run" | "planned" | "too-short" };

/**
 * Whether stopping now should create a session.
 *
 * `plannedSessionId` is the sessionId on the timer state as it stood at the stop - if StudyLife
 * had a planned session attached, it is already accounting for this time.
 */
export function decide(
  run: TimerRun | undefined,
  plannedSessionId: number | null | undefined,
  now: number,
): Decision {
  if (!run) return { log: false, reason: "no-run" };
  if (typeof plannedSessionId === "number") return { log: false, reason: "planned" };
  if (now - run.startedAt < MINIMUM_LOGGABLE_MS) return { log: false, reason: "too-short" };
  return { log: true, courseId: run.courseId, startedAt: run.startedAt, endedAt: now };
}
