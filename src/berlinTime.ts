// Europe/Berlin wall-clock <-> UTC-instant conversion.
//
// StudyLife's server is naive-local Europe/Berlin: every DateTime it sends or expects carries no
// offset in JSON and means Berlin wall-clock, regardless of what timezone the machine running
// this extension happens to be in (see studylife-raycast's berlinTime.ts and
// studylife-streamdeck's equivalent - the same account-wide gotcha, ported here rather than
// reinvented). `Date.parse` on a string with no "Z"/offset uses whatever zone THIS process is
// running in, which is wrong whenever that is not also Europe/Berlin - it silently buckets a
// session into the wrong day or treats a still-future one as already past.
//
// Only the read direction is needed here (StudySession.startTime from GET /api/sessions, for
// panelModel.ts's upcomingSessions) - this extension does not currently write any naive
// DateTime itself.
//
// Goes through Intl.DateTimeFormat with timeZone: "Europe/Berlin" rather than a hardcoded
// UTC+1/+2, so CET/CEST (and the DST transition dates themselves, which move slightly year to
// year) are always correct without a manually maintained table.

const BERLIN_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsAt(ms: number): WallClock {
  const parts = BERLIN_FORMAT.formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Europe/Berlin's UTC offset, in minutes, at a given instant (positive = ahead of UTC, so +60
 *  CET / +120 CEST). Found via a real Intl lookup rather than a fixed table, so it stays correct
 *  across DST transitions without maintenance. */
function offsetMinutesAt(ms: number): number {
  const p = partsAt(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - ms) / 60_000);
}

/**
 * The UTC instant a naive Europe/Berlin wall-clock string denotes ("2026-09-16T23:47:00"), as
 * milliseconds since the epoch - or NaN if it cannot be parsed. This is what StudySession's
 * startTime/endTime (from Sessions.GetAll/Sessions.GetHistory) actually mean, and what
 * `Date.parse` alone gets wrong outside Europe/Berlin.
 *
 * Works by reading the string's numbers as if they were UTC, then correcting by Berlin's offset
 * at that instant, with one extra correction pass in case the first guess landed on the other
 * side of a DST transition (only matters within the transition's own hour, twice a year).
 */
export function parseBerlinNaive(naive: string): number {
  const [datePart, timePart] = naive.split("T");
  const [y, m, d] = (datePart ?? "").split("-").map(Number);
  const [hh, mm, ss] = (timePart ?? "").split(":").map(Number);
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    Number.isNaN(y) ||
    Number.isNaN(m) ||
    Number.isNaN(d)
  ) {
    return NaN;
  }
  const asIfUtc = Date.UTC(y, m - 1, d, hh ?? 0, mm ?? 0, ss ?? 0);
  const firstGuess = asIfUtc - offsetMinutesAt(asIfUtc) * 60_000;
  return asIfUtc - offsetMinutesAt(firstGuess) * 60_000;
}

/** "14:05" - the Europe/Berlin wall-clock time of an instant, for display alongside a relative
 *  day ("today", "tomorrow", "in 3 days") rather than a full date. */
export function berlinClockTime(ms: number): string {
  const p = partsAt(ms);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Whole Europe/Berlin calendar days between `from` and `to` (positive when `to` is later) -
 *  today is 0, tomorrow is 1, and so on. Computed from the Berlin calendar date, not a raw
 *  86,400,000ms division, so it is unaffected by the DST transition days themselves. */
export function berlinDaysBetween(from: number, to: number): number {
  const a = partsAt(from);
  const b = partsAt(to);
  const aUtc = Date.UTC(a.year, a.month - 1, a.day);
  const bUtc = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bUtc - aUtc) / 86_400_000);
}
