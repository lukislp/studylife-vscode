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

/**
 * Below this a run is an accident - a start immediately undone, or a mis-click on the panel.
 *
 * Ten seconds, not the minute it started as: a deliberate one-minute focus block is a real
 * session, and dropping it silently is worse than recording something short. Anything dropped is
 * now reported rather than discarded quietly, which is what made the first threshold hurt.
 */
export const MINIMUM_LOGGABLE_MS = 10_000;

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

/**
 * The CourseName to send on POST /api/sessions - required non-empty by the server
 * (SessionService.Validate: "CourseName must not be empty.") even though CreateAsync
 * immediately resolves the real name from courseId and overwrites whatever was sent, keeping
 * the field only "for backward compatibility" (see StudySessionDto/SessionService.CreateAsync in
 * the studylife repo). This extension's NewSession never carried a courseName at all before -
 * every call to createSession() sent none, which the server bound to StudySessionDto's own
 * default ("") and then rejected with 400, unconditionally, regardless of the timer's state.
 *
 * `known` is whatever name this extension already has on hand (the workspace's remembered
 * course, or the one recorded when the run started) - used when available since it is the more
 * meaningful value to have shown here before the audit-M2 change landed. When nothing is known,
 * the courseId itself is a safe, always-non-empty fallback: the server ignores this field's
 * content either way, so all that matters is that it is not blank.
 */
export function placeholderCourseName(courseId: number, known: string | undefined): string {
  return known !== undefined && known.trim().length > 0 ? known : String(courseId);
}
