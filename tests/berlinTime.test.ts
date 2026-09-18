import { describe, expect, it } from "vitest";
import { berlinClockTime, berlinDaysBetween, parseBerlinNaive } from "../src/berlinTime.js";

describe("parseBerlinNaive", () => {
  it("reads a naive string as Europe/Berlin winter time (CET, UTC+1)", () => {
    // 2026-01-15 10:00 Berlin (CET) is 09:00 UTC.
    const ms = parseBerlinNaive("2026-01-15T10:00:00");
    expect(new Date(ms).toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("reads a naive string as Europe/Berlin summer time (CEST, UTC+2)", () => {
    // 2026-07-15 10:00 Berlin (CEST) is 08:00 UTC.
    const ms = parseBerlinNaive("2026-07-15T10:00:00");
    expect(new Date(ms).toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });

  it("round-trips through a DST transition without drifting an hour", () => {
    // 2026 spring-forward is the last Sunday in March (29th), 02:00 -> 03:00 CEST.
    const beforeMs = parseBerlinNaive("2026-03-29T01:30:00");
    const afterMs = parseBerlinNaive("2026-03-29T03:30:00");
    expect(new Date(beforeMs).toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(new Date(afterMs).toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("returns NaN for an unparseable string", () => {
    expect(Number.isNaN(parseBerlinNaive("not a date"))).toBe(true);
  });
});

describe("berlinClockTime", () => {
  it("formats the Europe/Berlin wall-clock time", () => {
    const ms = parseBerlinNaive("2026-09-16T14:05:00");
    expect(berlinClockTime(ms)).toBe("14:05");
  });
});

describe("berlinDaysBetween", () => {
  it("is zero for the same Berlin calendar day", () => {
    const morning = parseBerlinNaive("2026-09-16T08:00:00");
    const evening = parseBerlinNaive("2026-09-16T22:00:00");
    expect(berlinDaysBetween(morning, evening)).toBe(0);
  });

  it("is one for the next Berlin calendar day, even across the DST boundary", () => {
    const today = parseBerlinNaive("2026-09-16T08:00:00");
    const tomorrow = parseBerlinNaive("2026-09-17T08:00:00");
    expect(berlinDaysBetween(today, tomorrow)).toBe(1);
  });

  it("counts several days ahead", () => {
    const today = parseBerlinNaive("2026-09-16T08:00:00");
    const inFiveDays = parseBerlinNaive("2026-09-21T08:00:00");
    expect(berlinDaysBetween(today, inFiveDays)).toBe(5);
  });
});
