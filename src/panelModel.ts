// What the panel shows, as plain data. No vscode and no DOM in here, so the decisions that are
// easy to get wrong - which courses count as active, what the progress bar may honestly claim,
// how an empty metrics response renders - are testable on their own. panel.ts turns this into
// HTML.

import type { MetricsSummary, StudySession, UpcomingGoal } from "./api.js";
import { type Stretch, durationMs, formatDuration, formatHours } from "./activity.js";
import { berlinClockTime, berlinDaysBetween, parseBerlinNaive } from "./berlinTime.js";
import {
  type TimerState,
  canChangeMode,
  formatCountdown,
  modeName,
  phaseOf,
  progress,
  remainingMs,
} from "./timer.js";

export interface Snapshot {
  connected: boolean;
  timer?: TimerState | undefined;
  metrics?: MetricsSummary | undefined;
  tracked?: Stretch | undefined;
  courseName?: string | undefined;
  /** Summed from the session history - the metrics API carries no daily figure. */
  todayHours?: number | undefined;
  /**
   * Milliseconds left in the phase when *this window* paused it (extension.ts's RESUME_KEY),
   * or undefined when nothing is paused locally. The wire shape has no paused flag - a paused
   * timer and a stopped one both read back `isRunning: false` - so this is the only way to tell
   * them apart, and only for the window that set it. Ignored while `timer` is actually running.
   */
  pausedRemainingMs?: number | undefined;
  /** Every session from GET /api/sessions (Sessions.GetAll), past and future - undefined when
   *  this installation was not granted that scope, or the poll fetching it failed. Filtered and
   *  sorted down to the next few upcoming ones by upcomingSessions() below; this is never
   *  day-windowed or paginated server-side (see StudySession's doc comment), so all of it has to
   *  be shipped over just to pick a handful out client-side. */
  sessions?: StudySession[] | undefined;
  now: number;
}

export interface TimerCard {
  /** "Focus", "Break", "Paused" or "Stopped" - the headline state. */
  phase: string;
  /** "24:13", or undefined when nothing is running. */
  countdown?: string | undefined;
  /** 0..1, or undefined when the length cannot be known (custom mode) - render indeterminate. */
  progress?: number | undefined;
  /** "Flow State", when the mode is a built-in one. */
  mode?: string | undefined;
  round?: string | undefined;
  running: boolean;
  /** True when `phase` is "Paused" - split out as its own boolean so callers do not need to
   *  compare against the display string to tell a resumable pause from a real stop. */
  paused: boolean;
  /** Whether the preset may be changed right now - not while a phase is counting down against
   *  the current length. */
  canChangeMode: boolean;
}

export interface StatTile {
  label: string;
  value: string;
}

export interface GoalRow {
  name: string;
  due: string;
  /** Overdue goals are worth marking: the countdown alone reads the same as "in 3 days". */
  overdue: boolean;
}

export interface UpcomingSessionRow {
  courseName: string;
  /** "today at 14:05", "tomorrow at 09:00", "in 3 days at 16:30" - mirrors GoalRow.due's
   *  today/in-N-days phrasing, with the clock time appended since a session (unlike a goal's
   *  target date) is scheduled to a specific time, not just a day. */
  when: string;
}

export interface PanelModel {
  connected: boolean;
  timer: TimerCard;
  stats: StatTile[];
  goals: GoalRow[];
  upcomingSessions: UpcomingSessionRow[];
  courseName?: string | undefined;
  tracked?: string | undefined;
}

export function buildPanel(s: Snapshot): PanelModel {
  return {
    connected: s.connected,
    timer: timerCard(s),
    stats: stats(s.metrics, s.todayHours),
    goals: goals(s.metrics),
    upcomingSessions: upcomingSessions(s.sessions, s.now),
    ...(s.courseName === undefined ? {} : { courseName: s.courseName }),
    ...(s.tracked === undefined
      ? {}
      : {
          tracked: formatDuration(
            durationMs({ startedAt: s.tracked.startedAt, lastActivityAt: s.now }),
          ),
        }),
  };
}

function timerCard(s: Snapshot): TimerCard {
  const phase = phaseOf(s.timer);
  // A pause is a client-side illusion: the server has already gone back to isRunning: false,
  // indistinguishable from a real stop (see phaseOf's doc comment). s.pausedRemainingMs is the
  // one piece of local memory that says otherwise - and, for as long as it is set, the frozen
  // countdown to show instead of the running one remainingMs would otherwise no longer supply.
  const paused = phase === "stopped" && s.pausedRemainingMs !== undefined;
  const remaining = paused ? s.pausedRemainingMs : remainingMs(s.timer, s.now);
  const fraction = progress(s.timer, s.now);
  const round = s.timer?.currentRound;
  return {
    phase: paused
      ? "Paused"
      : phase === "stopped"
        ? "Stopped"
        : phase === "break"
          ? "Break"
          : "Focus",
    running: phase !== "stopped",
    paused,
    canChangeMode: canChangeMode(s.timer),
    ...(remaining === undefined ? {} : { countdown: formatCountdown(remaining) }),
    ...(fraction === undefined ? {} : { progress: fraction }),
    ...(modeName(s.timer) === undefined ? {} : { mode: modeName(s.timer) }),
    ...(phase === "stopped" || typeof round !== "number" ? {} : { round: `Round ${round}` }),
  };
}

function stats(metrics: MetricsSummary | undefined, todayHours: number | undefined): StatTile[] {
  const hours = metrics?.hours;
  const streak = metrics?.streak?.current;
  const tiles: StatTile[] = [
    { label: "Today", value: formatHours(todayHours) },
    { label: "This week", value: formatHours(hours?.week) },
  ];
  // A streak of zero is still worth showing - it is a fact, not a missing value.
  tiles.push({
    label: "Streak",
    value: typeof streak === "number" ? `${streak} day${streak === 1 ? "" : "s"}` : "-",
  });
  return tiles;
}

function goals(metrics: MetricsSummary | undefined): GoalRow[] {
  return activeGoals(metrics).map((g) => ({
    name: g.courseName,
    due:
      g.daysLeft < 0
        ? `${Math.abs(g.daysLeft)} day${Math.abs(g.daysLeft) === 1 ? "" : "s"} overdue`
        : g.daysLeft === 0
          ? "today"
          : `in ${g.daysLeft} day${g.daysLeft === 1 ? "" : "s"}`,
    overdue: g.daysLeft < 0,
  }));
}

/**
 * The courses worth offering when starting a session.
 *
 * StudyLife has no "active" flag on a course - the built-in catalogue alone carries around sixty,
 * and offering all of them is the wall of names this replaces. What it does have is course goals,
 * and the server already computes exactly the useful subset: upcomingCourseGoals is filtered to
 * goals with a target date that are NOT completed (StudyMetrics.CalcUpcomingCourseGoals), which
 * is precisely "courses I am currently working towards".
 *
 * Consequence worth knowing: an open goal with no target date is excluded upstream, so a course
 * tracked without a deadline will not appear here. The picker keeps an escape hatch to the full
 * catalogue for that case rather than hiding it.
 */
export function activeGoals(metrics: MetricsSummary | undefined): UpcomingGoal[] {
  const goals = metrics?.upcomingCourseGoals;
  return Array.isArray(goals) ? goals.filter((g) => typeof g?.courseId === "number") : [];
}

/** How many upcoming sessions the panel shows - a glance list, not a calendar. */
const MAX_UPCOMING_SESSIONS = 5;

/** "today at 14:05" / "tomorrow at 09:00" / "in 3 days at 16:30" - see UpcomingSessionRow.when. */
function formatSessionWhen(startMs: number, now: number): string {
  const daysAhead = berlinDaysBetween(now, startMs);
  const time = berlinClockTime(startMs);
  if (daysAhead <= 0) return `today at ${time}`;
  if (daysAhead === 1) return `tomorrow at ${time}`;
  return `in ${daysAhead} days at ${time}`;
}

/**
 * The next few planned sessions, soonest first.
 *
 * GET /api/sessions (Sessions.GetAll) returns every session ever created, past and future, with
 * no day window and no pagination (unlike Sessions.GetHistory) - see StudySession's doc comment.
 * So "upcoming" has to be picked out and sorted here rather than trusted from the response order.
 *
 * startTime is naive Europe/Berlin local time with no offset in the JSON (see berlinTime.ts) -
 * comparing it against `now` via a plain Date.parse would silently get "future" wrong on any
 * machine not itself running in Europe/Berlin, which is exactly the class of bug this account's
 * other StudyLife clients have hit before.
 */
export function upcomingSessions(
  sessions: StudySession[] | undefined,
  now: number,
): UpcomingSessionRow[] {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .map((s) => ({ session: s, startMs: parseBerlinNaive(s?.startTime ?? "") }))
    .filter(
      (x) => !Number.isNaN(x.startMs) && x.startMs > now && typeof x.session?.courseId === "number",
    )
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, MAX_UPCOMING_SESSIONS)
    .map((x) => ({
      courseName: x.session.courseName,
      when: formatSessionWhen(x.startMs, now),
    }));
}
