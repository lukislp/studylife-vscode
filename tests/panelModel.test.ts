import { describe, expect, it } from "vitest";
import type { UpcomingGoal } from "../src/api.js";
import { type Snapshot, activeGoals, buildPanel } from "../src/panelModel.js";

const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const MIN = 60_000;

function base(overrides: Partial<Snapshot> = {}): Snapshot {
  return { connected: true, now: NOW, ...overrides };
}

describe("timer card", () => {
  it("reads Stopped with no countdown when nothing runs", () => {
    const t = buildPanel(base()).timer;
    expect(t.phase).toBe("Stopped");
    expect(t.running).toBe(false);
    expect(t.countdown).toBeUndefined();
    expect(t.progress).toBeUndefined();
  });

  it("names the built-in mode and the round while running", () => {
    const t = buildPanel(
      base({
        timer: {
          isRunning: true,
          timerModeId: 2, // Flow State
          currentRound: 3,
          phaseEndsAt: new Date(NOW + 26 * MIN).toISOString(),
        },
      }),
    ).timer;
    expect(t.phase).toBe("Focus");
    expect(t.countdown).toBe("26:00");
    expect(t.mode).toBe("Flow State");
    expect(t.round).toBe("Round 3");
    expect(t.progress).toBeCloseTo(26 / 52, 5);
  });

  it("says Break during a break", () => {
    const t = buildPanel(
      base({ timer: { isRunning: true, isBreak: true, timerModeId: 1, phaseEndsAt: new Date(NOW + MIN).toISOString() } }),
    ).timer;
    expect(t.phase).toBe("Break");
  });

  it("omits the round when stopped - a round number without a session means nothing", () => {
    expect(buildPanel(base({ timer: { isRunning: false, currentRound: 4 } })).timer.round).toBeUndefined();
  });
});

describe("stats", () => {
  it("renders the three tiles from the metrics API", () => {
    const stats = buildPanel(
      base({ metrics: { hours: { today: 2.25, week: 9.5 }, streak: { current: 5 } } }),
    ).stats;
    expect(stats.map((s) => s.value)).toEqual(["2 h 15 min", "9 h 30 min", "5 days"]);
  });

  it("shows dashes rather than NaN when the response was empty", () => {
    expect(buildPanel(base()).stats.map((s) => s.value)).toEqual(["-", "-", "-"]);
  });

  it("shows a zero streak rather than hiding it - it is a fact, not a gap", () => {
    expect(buildPanel(base({ metrics: { streak: { current: 0 } } })).stats[2]?.value).toBe("0 days");
  });
});

describe("goals", () => {
  const goal = (name: string, daysLeft: number) => ({
    courseId: 1,
    courseName: name,
    targetDate: "",
    daysLeft,
  });

  it("phrases future, today and overdue differently", () => {
    const rows = buildPanel(
      base({
        metrics: {
          upcomingCourseGoals: [goal("A", 3), goal("B", 0), goal("C", -2), goal("D", 1)],
        },
      }),
    ).goals;
    expect(rows.map((r) => r.due)).toEqual(["in 3 days", "today", "2 days overdue", "in 1 day"]);
    expect(rows.map((r) => r.overdue)).toEqual([false, false, true, false]);
  });

  it("is empty when there are none", () => {
    expect(buildPanel(base()).goals).toEqual([]);
  });
});

describe("activeGoals", () => {
  // The server already filters upcomingCourseGoals to goals that are NOT completed
  // (StudyMetrics.CalcUpcomingCourseGoals), so this is the whole definition of "active" -
  // no second request and no local guessing.
  it("returns the goals the metrics summary carries", () => {
    const goals = [{ courseId: 7, courseName: "Mathe", targetDate: "", daysLeft: 3 }];
    expect(activeGoals({ upcomingCourseGoals: goals })).toEqual(goals);
  });

  it("returns an empty list rather than throwing on a malformed or missing field", () => {
    expect(activeGoals(undefined)).toEqual([]);
    expect(activeGoals({})).toEqual([]);
    expect(activeGoals({ upcomingCourseGoals: "nope" as unknown as [] })).toEqual([]);
  });

  it("drops entries without a usable course id - they could not be started anyway", () => {
    // Typed through UpcomingGoal so the cast stays local to the one deliberately broken entry -
    // `(typeof goals)[0]` inside the literal would be a circular reference.
    const goals: UpcomingGoal[] = [
      { courseId: 7, courseName: "Mathe", targetDate: "", daysLeft: 3 },
      { courseName: "Broken", targetDate: "", daysLeft: 1 } as unknown as UpcomingGoal,
    ];
    expect(activeGoals({ upcomingCourseGoals: goals })).toHaveLength(1);
  });
});

describe("workspace", () => {
  it("counts the tracked stretch up to now, not to the last keystroke", () => {
    const m = buildPanel(base({ tracked: { startedAt: NOW - 47 * MIN, lastActivityAt: NOW - 3 * MIN } }));
    expect(m.tracked).toBe("47 min");
  });

  it("leaves course and tracked unset when there is nothing to show", () => {
    const m = buildPanel(base());
    expect(m.courseName).toBeUndefined();
    expect(m.tracked).toBeUndefined();
  });
});
