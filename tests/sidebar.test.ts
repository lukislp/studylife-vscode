import { describe, expect, it } from "vitest";
import { type Row, type Snapshot, buildTree } from "../src/sidebarModel.js";

const MIN = 60_000;

function base(overrides: Partial<Snapshot> = {}): Snapshot {
  return { connected: true, now: 0, ...overrides };
}

function section(rows: Row[], label: string): Row {
  const found = rows.find((r) => r.label === label);
  if (!found) throw new Error(`no section "${label}" in [${rows.map((r) => r.label).join(", ")}]`);
  return found;
}

describe("disconnected", () => {
  it("shows a single actionable row instead of empty sections", () => {
    const rows = buildTree({ connected: false, now: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.command).toBe("studylife.connect");
  });
});

describe("timer section", () => {
  it("offers the course picker only while stopped", () => {
    // Changing the course of a running session would re-attribute time already spent.
    const stopped = section(buildTree(base({ timer: { isRunning: false } })), "Timer");
    expect(stopped.children?.[0]?.label).toBe("Stopped");
    expect(stopped.children?.[0]?.command).toBe("studylife.startTimerWithCourse");

    const running = section(buildTree(base({ timer: { isRunning: true } })), "Timer");
    expect(running.children?.[0]?.label).toBe("Running");
    expect(running.children?.[0]?.command).toBeUndefined();
  });

  it("distinguishes paused from running and from stopped", () => {
    const paused = section(
      buildTree(base({ timer: { isRunning: true, isPaused: true } })),
      "Timer",
    );
    expect(paused.children?.[0]?.label).toBe("Paused");
    // A paused session is still a session: no course picker either.
    expect(paused.children?.[0]?.command).toBeUndefined();
  });

  it("treats a missing timer state as stopped rather than throwing", () => {
    expect(section(buildTree(base()), "Timer").children?.[0]?.label).toBe("Stopped");
  });
});

describe("study time section", () => {
  it("renders hours from the metrics API", () => {
    const rows = section(
      buildTree(base({ metrics: { hours: { today: 2.25, week: 9.5 } } })),
      "Study time",
    );
    expect(rows.children?.[0]?.detail).toBe("2 h 15 min");
    expect(rows.children?.[1]?.detail).toBe("9 h 30 min");
  });

  it("shows a dash rather than NaN when the metrics call came back empty", () => {
    const rows = section(buildTree(base()), "Study time");
    expect(rows.children?.[0]?.detail).toBe("-");
  });

  it("omits the streak entirely when absent, and pluralises when present", () => {
    expect(section(buildTree(base()), "Study time").children).toHaveLength(2);
    const one = section(buildTree(base({ metrics: { streak: { current: 1 } } })), "Study time");
    expect(one.children?.[2]?.detail).toBe("1 day");
    const many = section(buildTree(base({ metrics: { streak: { current: 4 } } })), "Study time");
    expect(many.children?.[2]?.detail).toBe("4 days");
  });
});

describe("upcoming goals", () => {
  it("says None rather than showing an empty section", () => {
    expect(section(buildTree(base()), "Upcoming goals").children?.[0]?.label).toBe("None");
  });

  it("lists goals with their countdown", () => {
    const rows = section(
      buildTree(
        base({
          metrics: {
            upcomingCourseGoals: [
              { courseId: 1, courseName: "Betriebssysteme", targetDate: "", daysLeft: 1 },
              { courseId: 2, courseName: "Mathe", targetDate: "", daysLeft: 12 },
            ],
          },
        }),
      ),
      "Upcoming goals",
    );
    expect(rows.children?.[0]?.detail).toBe("in 1 day");
    expect(rows.children?.[1]?.detail).toBe("in 12 days");
  });

  it("caps the list so the sections below stay visible in a narrow panel", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      courseId: i,
      courseName: `Course ${i}`,
      targetDate: "",
      daysLeft: i,
    }));
    const rows = section(
      buildTree(base({ metrics: { upcomingCourseGoals: many } })),
      "Upcoming goals",
    );
    expect(rows.children).toHaveLength(5);
  });
});

describe("workspace section", () => {
  it("shows the course and makes it clickable", () => {
    const rows = section(buildTree(base({ courseName: "Mathe" })), "This workspace");
    expect(rows.children?.[0]?.detail).toBe("Mathe");
    expect(rows.children?.[0]?.command).toBe("studylife.setWorkspaceCourse");
  });

  it("says 'not set' when no course is mapped yet", () => {
    expect(section(buildTree(base()), "This workspace").children?.[0]?.detail).toBe("not set");
  });

  it("adds the tracked stretch only when something is being tracked", () => {
    expect(section(buildTree(base()), "This workspace").children).toHaveLength(1);
    const tracking = section(
      buildTree(base({ tracked: { startedAt: 0, lastActivityAt: 0 }, now: 47 * MIN })),
      "This workspace",
    );
    expect(tracking.children).toHaveLength(2);
    // Measured to "now", not to the last keystroke - the panel should keep counting while the
    // stretch is still open.
    expect(tracking.children?.[1]?.detail).toBe("47 min");
    expect(tracking.children?.[1]?.command).toBe("studylife.logCodingTime");
  });
});

describe("overall shape", () => {
  it("always returns the four sections when connected, all expanded", () => {
    const rows = buildTree(base());
    expect(rows.map((r) => r.label)).toEqual([
      "Timer",
      "Study time",
      "Upcoming goals",
      "This workspace",
    ]);
    expect(rows.every((r) => r.expanded)).toBe(true);
  });
});
