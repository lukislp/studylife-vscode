// The status bar entry. Renders whatever the last poll returned; it never computes study numbers
// itself - those come from /api/metrics/summary, which is the one place StudyLife calculates them
// (see MetricsController's doc comment). Re-deriving them here would eventually disagree with the
// web app over some edge case nobody would think to check.
import * as vscode from "vscode";
import type { MetricsSummary, TimerState } from "./api.js";
import { type Stretch, durationMs, formatDuration, formatHours } from "./activity.js";

export interface RenderInput {
  connected: boolean;
  timer?: TimerState | undefined;
  metrics?: MetricsSummary | undefined;
  tracked?: Stretch | undefined;
  todayHours?: number | undefined;
  now: number;
}

/** Split out from the vscode item so the text/tooltip rules are unit-testable. */
export function renderLabel(input: RenderInput): string {
  if (!input.connected) return "$(circle-slash) StudyLife";
  if (input.timer?.isRunning) {
    return input.timer.isPaused ? "$(debug-pause) StudyLife" : "$(record) StudyLife";
  }
  const today = input.todayHours;
  return today === undefined ? "$(watch) StudyLife" : `$(watch) ${formatHours(today)}`;
}

export function renderTooltip(input: RenderInput): string {
  if (!input.connected) {
    return "Not connected to a StudyLife instance.\nRun “StudyLife: Connect to an instance”.";
  }
  const lines: string[] = [];
  const timerLine = input.timer?.isRunning
    ? input.timer.isPaused
      ? "Focus timer: paused"
      : "Focus timer: running"
    : "Focus timer: stopped";
  lines.push(timerLine);

  const hours = input.metrics?.hours;
  if (input.todayHours !== undefined) lines.push(`Today: ${formatHours(input.todayHours)}`);
  if (hours?.week !== undefined) lines.push(`This week: ${formatHours(hours.week)}`);

  const streak = input.metrics?.streak?.current;
  if (streak !== undefined) lines.push(`Streak: ${streak} day${streak === 1 ? "" : "s"}`);

  const next = input.metrics?.upcomingCourseGoals?.[0];
  if (next) {
    lines.push(`Next: ${next.courseName} in ${next.daysLeft} day${next.daysLeft === 1 ? "" : "s"}`);
  }

  if (input.tracked) {
    const open: Stretch = { startedAt: input.tracked.startedAt, lastActivityAt: input.now };
    lines.push(`Tracking: ${formatDuration(durationMs(open))} in this workspace`);
  }
  return lines.join("\n");
}

export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "studylife.refresh";
    this.item.show();
  }

  render(input: RenderInput): void {
    this.item.text = renderLabel(input);
    this.item.tooltip = renderTooltip(input);
  }

  dispose(): void {
    this.item.dispose();
  }
}
