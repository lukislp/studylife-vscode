import fc from "fast-check";
import { describe, it } from "vitest";
import { berlinClockTime, berlinDaysBetween, parseBerlinNaive } from "../src/berlinTime.js";
import { escapeHtml } from "../src/html.js";

const pad = (n: number): string => String(n).padStart(2, "0");

// Hours 04-22 sidestep the two DST transition hours (02:00-03:00), where a wall-clock reading is
// either ambiguous (autumn) or does not exist (spring).
const naive = fc.record({
  year: fc.integer({ min: 2000, max: 2060 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 }),
  hour: fc.integer({ min: 4, max: 22 }),
  minute: fc.integer({ min: 0, max: 59 }),
});

const toNaive = (n: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}): string => `${n.year}-${pad(n.month)}-${pad(n.day)}T${pad(n.hour)}:${pad(n.minute)}:00`;

describe("berlinTime (property-based)", () => {
  it("a naive Berlin wall-clock string reads back as the same Berlin clock time", () => {
    fc.assert(
      fc.property(
        naive,
        (n) => berlinClockTime(parseBerlinNaive(toNaive(n))) === `${pad(n.hour)}:${pad(n.minute)}`,
      ),
    );
  });

  it("parseBerlinNaive is strictly increasing with the wall clock", () => {
    fc.assert(
      fc.property(naive, naive, (a, b) => {
        const [sa, sb] = [toNaive(a), toNaive(b)];
        if (sa === sb) return true;
        const [lo, hi] = sa < sb ? [sa, sb] : [sb, sa];
        return parseBerlinNaive(lo) < parseBerlinNaive(hi);
      }),
    );
  });

  it("berlinDaysBetween is antisymmetric and zero for the same instant", () => {
    const ms = fc.integer({ min: 946_684_800_000, max: 4_102_444_800_000 });
    fc.assert(
      fc.property(
        ms,
        ms,
        (a, b) =>
          berlinDaysBetween(a, a) === 0 && berlinDaysBetween(a, b) === -berlinDaysBetween(b, a),
      ),
    );
  });

  it("berlinDaysBetween counts calendar days even across DST transitions", () => {
    fc.assert(
      fc.property(naive, fc.integer({ min: 0, max: 400 }), (n, days) => {
        const start = parseBerlinNaive(toNaive(n));
        const later = new Date(Date.UTC(n.year, n.month - 1, n.day + days));
        const laterNaive = toNaive({
          year: later.getUTCFullYear(),
          month: later.getUTCMonth() + 1,
          day: later.getUTCDate(),
          hour: n.hour,
          minute: n.minute,
        });
        return berlinDaysBetween(start, parseBerlinNaive(laterNaive)) === days;
      }),
    );
  });

  it("parseBerlinNaive never throws on arbitrary text", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        parseBerlinNaive(s);
        return true;
      }),
    );
  });
});

describe("escapeHtml (property-based)", () => {
  const unescape = (s: string): string =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");

  it("never emits a raw markup-significant character", () => {
    fc.assert(fc.property(fc.string(), (s) => !/[<>"']/.test(escapeHtml(s))));
  });

  it("is lossless: unescaping restores the original text", () => {
    fc.assert(fc.property(fc.string(), (s) => unescape(escapeHtml(s)) === s));
  });

  it("leaves text without special characters untouched", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/[&<>"']/.test(s)),
        (s) => escapeHtml(s) === s,
      ),
    );
  });
});
