import { describe, expect, it } from "vitest";
import { type SessionRecord, sumHoursOn } from "../src/api.js";

const NOON = new Date(2026, 8, 16, 12, 0, 0).getTime();
const H = 3_600_000;

function at(hour: number, minutes = 0): string {
  return new Date(2026, 8, 16, hour, minutes, 0).toISOString();
}

describe("sumHoursOn", () => {
  // MetricsHoursDto carries week, month and total - but no today, so this is where the daily
  // figure actually comes from.
  it("sums sessions that happened today", () => {
    const sessions: SessionRecord[] = [
      { startTime: at(8), endTime: at(9, 30) },
      { startTime: at(10), endTime: at(10, 45) },
    ];
    expect(sumHoursOn(sessions, NOON)).toBeCloseTo(2.25, 5);
  });

  it("ignores sessions from another day", () => {
    const yesterday = new Date(2026, 8, 15, 10, 0, 0).toISOString();
    const yesterdayEnd = new Date(2026, 8, 15, 12, 0, 0).toISOString();
    expect(sumHoursOn([{ startTime: yesterday, endTime: yesterdayEnd }], NOON)).toBe(0);
  });

  it("counts only today's part of a session spanning midnight", () => {
    const sessions: SessionRecord[] = [
      { startTime: new Date(2026, 8, 15, 23, 0, 0).toISOString(), endTime: at(1) },
    ];
    expect(sumHoursOn(sessions, NOON) * H).toBeCloseTo(1 * H, 0);
  });

  it("skips malformed entries instead of throwing", () => {
    const sessions: SessionRecord[] = [
      { startTime: at(8), endTime: at(9) },
      { startTime: "nonsense", endTime: at(9) },
      { startTime: at(8) },
      {},
      // End before start - a corrupt row must not subtract from the total.
      { startTime: at(11), endTime: at(10) },
    ];
    expect(sumHoursOn(sessions, NOON)).toBeCloseTo(1, 5);
  });

  it("returns zero for an empty list", () => {
    expect(sumHoursOn([], NOON)).toBe(0);
  });
});
