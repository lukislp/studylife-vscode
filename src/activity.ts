// Coding-time tracking, kept free of vscode so the rules that decide what gets offered are
// testable on their own.
//
// Deliberately a SUGGESTION, never a silent recording. A wrongly attributed block would land in
// the same session history StudyLife correlates against grades and ECTS, so a bad guess does not
// just add noise - it quietly distorts an analysis the user trusts. The extension therefore only
// ever proposes; the user confirms the course and the block.

export interface Stretch {
  startedAt: number;
  lastActivityAt: number;
}

export interface TrackerOptions {
  idleMs: number;
  minimumMs: number;
}

/**
 * Accumulates editing activity into one open stretch. A pause longer than idleMs ends it; the
 * ended stretch is returned so the caller can decide whether to offer it.
 */
export class ActivityTracker {
  private open: Stretch | undefined;

  constructor(private readonly options: TrackerOptions) {}

  /** Records activity at `now`. Returns a stretch if this activity ENDED a previous one. */
  noteActivity(now: number): Stretch | undefined {
    if (!this.open) {
      this.open = { startedAt: now, lastActivityAt: now };
      return undefined;
    }
    if (now - this.open.lastActivityAt > this.options.idleMs) {
      const finished = this.open;
      this.open = { startedAt: now, lastActivityAt: now };
      return finished;
    }
    this.open.lastActivityAt = now;
    return undefined;
  }

  /** Ends the open stretch (window closed, editor lost focus for good, extension shutting down). */
  flush(): Stretch | undefined {
    const finished = this.open;
    this.open = undefined;
    return finished;
  }

  /** The stretch currently accumulating, if any - for the status bar tooltip. */
  peek(): Stretch | undefined {
    return this.open;
  }

  /** Whether a finished stretch is long enough to be worth offering. */
  isWorthOffering(stretch: Stretch): boolean {
    return durationMs(stretch) >= this.options.minimumMs;
  }
}

export function durationMs(stretch: Stretch): number {
  return Math.max(0, stretch.lastActivityAt - stretch.startedAt);
}

/** "2 h 14 min", "47 min", "0 min" - the shape used in the status bar and the prompt alike. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/**
 * Hours as StudyLife reports them (a decimal) rendered the same way. Kept separate from
 * formatDuration so a change to one cannot silently reformat the other.
 */
export function formatHours(hours: number | undefined): string {
  if (hours === undefined || Number.isNaN(hours)) return "-";
  return formatDuration(Math.round(hours * 3_600_000));
}
