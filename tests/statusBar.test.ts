import { describe, expect, it } from "vitest";
import { type RenderInput, renderLabel, renderTooltip } from "../src/statusBar.js";

function base(overrides: Partial<RenderInput> = {}): RenderInput {
  return { connected: true, now: 0, ...overrides };
}

// The wire has no paused flag (see timer.ts's phaseOf) - a paused timer and a stopped one both
// read back isRunning: false. pausedLocally is extension.ts's own memory of a pause it is still
// holding (RESUME_KEY), and it is the only thing that can tell the two apart here - previously
// these functions read a timer.isPaused field that the server never sends and nothing ever set,
// so a pause always rendered identically to a stop.
describe("renderLabel", () => {
  it("shows the recording dot while genuinely running", () => {
    expect(renderLabel(base({ timer: { isRunning: true } }))).toBe("$(record) StudyLife");
  });

  it("shows the pause icon when this window is holding a pause", () => {
    expect(renderLabel(base({ timer: { isRunning: false }, pausedLocally: true }))).toBe(
      "$(debug-pause) StudyLife",
    );
  });

  it("falls back to the watch icon for a real stop", () => {
    expect(renderLabel(base({ timer: { isRunning: false } }))).toBe("$(watch) StudyLife");
  });

  it("ignores pausedLocally while the timer is actually running", () => {
    expect(renderLabel(base({ timer: { isRunning: true }, pausedLocally: true }))).toBe(
      "$(record) StudyLife",
    );
  });

  it("shows today's hours over the watch icon once known", () => {
    expect(renderLabel(base({ timer: { isRunning: false }, todayHours: 1.5 }))).toBe(
      "$(watch) 1 h 30 min",
    );
  });

  it("shows the disconnected icon before anything else", () => {
    expect(renderLabel(base({ connected: false, timer: { isRunning: true } }))).toBe(
      "$(circle-slash) StudyLife",
    );
  });
});

describe("renderTooltip", () => {
  it("says paused, not stopped, when this window is holding a pause", () => {
    expect(renderTooltip(base({ timer: { isRunning: false }, pausedLocally: true }))).toContain(
      "Focus timer: paused",
    );
  });

  it("says stopped when nothing is remembered locally", () => {
    expect(renderTooltip(base({ timer: { isRunning: false } }))).toContain("Focus timer: stopped");
  });

  it("says running over pausedLocally when the timer is actually running", () => {
    expect(renderTooltip(base({ timer: { isRunning: true }, pausedLocally: true }))).toContain(
      "Focus timer: running",
    );
  });
});
