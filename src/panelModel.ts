// What the panel shows, as plain data. No vscode and no DOM in here, so the decisions that are
// easy to get wrong - which courses count as active, what the progress bar may honestly claim,
// how an empty metrics response renders - are testable on their own. panel.ts turns this into
// HTML.

import type { MetricsSummary, UpcomingGoal } from "./api.js";
import { type Stretch, durationMs, formatDuration, formatHours } from "./activity.js";
import {
  type TimerState,
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
  now: number;
}

export interface TimerCard {
  /** "Focus", "Break" or "Stopped" - the headline state. */
  phase: string;
  /** "24:13", or undefined when nothing is running. */
  countdown?: string | undefined;
  /** 0..1, or undefined when the length cannot be known (custom mode) - render indeterminate. */
  progress?: number | undefined;
  /** "Flow State", when the mode is a built-in one. */
  mode?: string | undefined;
  round?: string | undefined;
  running: boolean;
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

export interface PanelModel {
  connected: boolean;
  timer: TimerCard;
  stats: StatTile[];
  goals: GoalRow[];
  courseName?: string | undefined;
  tracked?: string | undefined;
}

export function buildPanel(s: Snapshot): PanelModel {
  return {
    connected: s.connected,
    timer: timerCard(s),
    stats: stats(s.metrics, s.todayHours),
    goals: goals(s.metrics),
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
  const remaining = remainingMs(s.timer, s.now);
  const fraction = progress(s.timer, s.now);
  const round = s.timer?.currentRound;
  return {
    phase: phase === "stopped" ? "Stopped" : phase === "break" ? "Break" : "Focus",
    running: phase !== "stopped",
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
