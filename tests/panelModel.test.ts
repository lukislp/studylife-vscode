import { describe, expect, it } from "vitest";
import type { StudySession, UpcomingGoal } from "../src/api.js";
import { type Snapshot, activeGoals, buildPanel, upcomingSessions } from "../src/panelModel.js";

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
      base({
        timer: {
          isRunning: true,
          isBreak: true,
          timerModeId: 1,
          phaseEndsAt: new Date(NOW + MIN).toISOString(),
        },
      }),
    ).timer;
    expect(t.phase).toBe("Break");
  });

  it("omits the round when stopped - a round number without a session means nothing", () => {
    expect(
      buildPanel(base({ timer: { isRunning: false, currentRound: 4 } })).timer.round,
    ).toBeUndefined();
  });
});

describe("paused vs. stopped", () => {
  // The wire has no paused flag (see timer.ts's phaseOf) - a pause and a real stop both come
  // back as isRunning: false. pausedRemainingMs is the extension's own memory of a pause it is
  // still holding (extension.ts's RESUME_KEY), and it is the only thing that can tell the two
  // apart at render time.
  it("reads Paused, with the frozen remainder as the countdown, when this window is holding a pause", () => {
    const t = buildPanel(
      base({ timer: { isRunning: false }, pausedRemainingMs: 8 * MIN + 30_000 }),
    ).timer;
    expect(t.phase).toBe("Paused");
    expect(t.paused).toBe(true);
    expect(t.running).toBe(false);
    expect(t.countdown).toBe("8:30");
  });

  it("still reads Stopped, not Paused, when nothing is remembered locally", () => {
    const t = buildPanel(base({ timer: { isRunning: false } })).timer;
    expect(t.phase).toBe("Stopped");
    expect(t.paused).toBe(false);
    expect(t.countdown).toBeUndefined();
  });

  it("ignores a leftover pausedRemainingMs while the timer is genuinely running", () => {
    // Should not happen in practice - RESUME_KEY is cleared before a start is sent - but the
    // render layer must not invent "Paused" over a phase that is actually counting down.
    const t = buildPanel(
      base({
        timer: {
          isRunning: true,
          timerModeId: 1,
          phaseEndsAt: new Date(NOW + 10 * MIN).toISOString(),
        },
        pausedRemainingMs: 5 * MIN,
      }),
    ).timer;
    expect(t.phase).toBe("Focus");
    expect(t.paused).toBe(false);
    expect(t.countdown).toBe("10:00");
  });

  it("does not read Paused off a real stop that also reset the session", () => {
    // A stop resets currentRound to 1 and clears sessionId, but neither of those - only the
    // local pausedRemainingMs - decides Paused vs. Stopped.
    const t = buildPanel(
      base({ timer: { isRunning: false, sessionId: null, currentRound: 1 } }),
    ).timer;
    expect(t.phase).toBe("Stopped");
    expect(t.paused).toBe(false);
  });
});

describe("stats", () => {
  it("renders the three tiles from the metrics API", () => {
    const stats = buildPanel(
      base({ metrics: { hours: { week: 9.5 }, streak: { current: 5 } }, todayHours: 2.25 }),
    ).stats;
    expect(stats.map((s) => s.value)).toEqual(["2 h 15 min", "9 h 30 min", "5 days"]);
  });

  it("shows dashes rather than NaN when the response was empty", () => {
    expect(buildPanel(base()).stats.map((s) => s.value)).toEqual(["-", "-", "-"]);
  });

  it("shows a zero streak rather than hiding it - it is a fact, not a gap", () => {
    expect(buildPanel(base({ metrics: { streak: { current: 0 } } })).stats[2]?.value).toBe(
      "0 days",
    );
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

describe("upcomingSessions", () => {
  // NOW is 2026-09-16T12:00:00Z, which is 2026-09-16 14:00 Europe/Berlin (CEST, UTC+2) - every
  // naive startTime below is read that way, exactly as StudySession.startTime from GET
  // /api/sessions actually is.
  function session(overrides: Partial<StudySession> = {}): StudySession {
    return {
      id: 1,
      courseId: 7,
      courseName: "Mathe",
      startTime: "2026-09-17T09:00:00",
      endTime: "2026-09-17T10:00:00",
      isCompleted: false,
      ...overrides,
    };
  }

  it("drops past sessions and phrases today/tomorrow/in-N-days like GoalRow.due, with the time appended", () => {
    const rows = upcomingSessions(
      [
        session({ courseName: "Already done", startTime: "2026-09-16T08:00:00" }), // past - dropped
        session({ courseName: "Later today", startTime: "2026-09-16T16:00:00" }),
        session({ courseName: "Tomorrow morning", startTime: "2026-09-17T09:00:00" }),
        session({ courseName: "In a few days", startTime: "2026-09-20T10:30:00" }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.courseName)).toEqual([
      "Later today",
      "Tomorrow morning",
      "In a few days",
    ]);
    expect(rows.map((r) => r.when)).toEqual([
      "today at 16:00",
      "tomorrow at 09:00",
      "in 4 days at 10:30",
    ]);
  });

  it("sorts ascending by start time regardless of input order", () => {
    const rows = upcomingSessions(
      [
        session({ courseName: "Third", startTime: "2026-09-20T10:00:00" }),
        session({ courseName: "First", startTime: "2026-09-16T15:00:00" }),
        session({ courseName: "Second", startTime: "2026-09-17T08:00:00" }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.courseName)).toEqual(["First", "Second", "Third"]);
  });

  it("takes only the first 5", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      session({
        courseName: `Session ${i}`,
        startTime: `2026-09-${String(17 + i).padStart(2, "0")}T09:00:00`,
      }),
    );
    expect(upcomingSessions(many, NOW)).toHaveLength(5);
  });

  it("returns an empty list for missing, malformed or entirely-past input", () => {
    expect(upcomingSessions(undefined, NOW)).toEqual([]);
    expect(upcomingSessions([], NOW)).toEqual([]);
    expect(upcomingSessions("nope" as unknown as StudySession[], NOW)).toEqual([]);
    expect(upcomingSessions([session({ startTime: "2020-01-01T00:00:00" })], NOW)).toEqual([]);
    expect(upcomingSessions([session({ startTime: "not a date" })], NOW)).toEqual([]);
  });

  it("is reflected in buildPanel's upcomingSessions field", () => {
    const m = buildPanel(base({ sessions: [session({ startTime: "2026-09-17T09:00:00" })] }));
    expect(m.upcomingSessions).toHaveLength(1);
    expect(m.upcomingSessions[0]?.courseName).toBe("Mathe");
  });

  it("is empty in buildPanel when no sessions were fetched (missing scope, or a failed poll)", () => {
    expect(buildPanel(base()).upcomingSessions).toEqual([]);
  });
});

describe("workspace", () => {
  it("counts the tracked stretch up to now, not to the last keystroke", () => {
    const m = buildPanel(
      base({ tracked: { startedAt: NOW - 47 * MIN, lastActivityAt: NOW - 3 * MIN } }),
    );
    expect(m.tracked).toBe("47 min");
  });

  it("leaves course and tracked unset when there is nothing to show", () => {
    const m = buildPanel(base());
    expect(m.courseName).toBeUndefined();
    expect(m.tracked).toBeUndefined();
  });
});
