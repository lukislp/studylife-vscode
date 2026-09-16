// What the sidebar shows, as plain data. Deliberately free of any vscode import so the row
// shapes - which is where the mistakes live - can be tested without an editor; sidebar.ts turns
// these into TreeItems. Built from the same snapshot the status bar renders, so the two can
// never disagree about what is running.
import type { MetricsSummary, TimerState } from "./api.js";
import { type Stretch, durationMs, formatDuration, formatHours } from "./activity.js";

export interface Snapshot {
  connected: boolean;
  timer?: TimerState | undefined;
  metrics?: MetricsSummary | undefined;
  tracked?: Stretch | undefined;
  courseName?: string | undefined;
  now: number;
}

/** What a row is, independent of vscode's TreeItem - this is what the tests assert on. */
export interface Row {
  label: string;
  /** Rendered as the dimmed text after the label. */
  detail?: string;
  icon?: string;
  command?: string;
  children?: Row[];
  expanded?: boolean;
}

export function buildTree(s: Snapshot): Row[] {
  if (!s.connected) {
    return [
      {
        label: "Not connected",
        detail: "Click to connect to an instance",
        icon: "plug",
        command: "studylife.connect",
      },
    ];
  }

  return [timerSection(s), studySection(s), goalsSection(s), workspaceSection(s)];
}

function timerSection(s: Snapshot): Row {
  const running = s.timer?.isRunning === true;
  const paused = running && s.timer?.isPaused === true;
  const label = !running ? "Stopped" : paused ? "Paused" : "Running";
  // A stopped timer offers the course picker; a running one does not, because changing the course
  // mid-session would silently re-attribute time already spent.
  const row: Row = {
    label: "Timer",
    expanded: true,
    children: [
      {
        label,
        icon: !running ? "primitive-square" : paused ? "debug-pause" : "record",
        ...(running ? {} : { detail: "Click to start with a course", command: "studylife.startTimerWithCourse" }),
      },
    ],
  };
  return row;
}

function studySection(s: Snapshot): Row {
  const hours = s.metrics?.hours;
  const streak = s.metrics?.streak?.current;
  const children: Row[] = [
    { label: "Today", detail: formatHours(hours?.today), icon: "clock" },
    { label: "This week", detail: formatHours(hours?.week), icon: "calendar" },
  ];
  if (typeof streak === "number") {
    children.push({
      label: "Streak",
      detail: `${streak} day${streak === 1 ? "" : "s"}`,
      icon: "flame",
    });
  }
  return { label: "Study time", expanded: true, children };
}

function goalsSection(s: Snapshot): Row {
  const goals = s.metrics?.upcomingCourseGoals ?? [];
  if (goals.length === 0) {
    return {
      label: "Upcoming goals",
      expanded: true,
      children: [{ label: "None", icon: "check" }],
    };
  }
  return {
    label: "Upcoming goals",
    expanded: true,
    // Capped: the panel is narrow and a long list would push the sections below it out of sight.
    children: goals.slice(0, 5).map((g) => ({
      label: g.courseName,
      detail: `in ${g.daysLeft} day${g.daysLeft === 1 ? "" : "s"}`,
      icon: "milestone",
    })),
  };
}

function workspaceSection(s: Snapshot): Row {
  const children: Row[] = [
    {
      label: "Course",
      detail: s.courseName ?? "not set",
      icon: "book",
      command: "studylife.setWorkspaceCourse",
    },
  ];
  if (s.tracked) {
    const open: Stretch = { startedAt: s.tracked.startedAt, lastActivityAt: s.now };
    children.push({
      label: "Tracked",
      detail: formatDuration(durationMs(open)),
      icon: "edit",
      command: "studylife.logCodingTime",
    });
  }
  return { label: "This workspace", expanded: true, children };
}
