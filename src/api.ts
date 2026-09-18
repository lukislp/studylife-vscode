// Typed client for exactly the six endpoints this extension is scoped for. Every method maps to
// one entry the client requests at registration; adding a call here means adding the scope there
// (and having it be publicly grantable server-side), never the other way round.
import { trimBase } from "./oauth.js";
// The timer shape lives with the transition rules it belongs to.
export type { TimerState } from "./timer.js";
import type { TimerState } from "./timer.js";

export interface Course {
  id: number;
  name: string;
  color?: string;
  icon?: string;
  semester?: number;
}

export interface UpcomingGoal {
  courseId: number;
  courseName: string;
  targetDate: string;
  daysLeft: number;
}

export interface MetricsSummary {
  streak?: { current?: number };
  /** The API has no "today" figure - only week, month and total (MetricsHoursDto). Today is
   *  summed from the session history instead, see StudyLifeApi.getTodayHours. */
  hours?: { week?: number; month?: number; total?: number };
  upcomingCourseGoals?: UpcomingGoal[];
  [key: string]: unknown;
}

export interface SessionRecord {
  startTime?: string;
  endTime?: string;
  isCompleted?: boolean;
  [key: string]: unknown;
}

/**
 * A row from GET /api/sessions (Sessions.GetAll) - every session ever created, past and future,
 * with no day window and no pagination (unlike Sessions.GetHistory - see SessionsController's
 * doc comment on GetAll in the studylife repo). startTime/endTime are naive Europe/Berlin local
 * time, no offset in the JSON - see berlinTime.ts.
 */
export interface StudySession {
  id: number;
  courseId: number;
  courseName: string;
  courseColor?: string;
  startTime: string;
  endTime: string;
  topic?: string;
  notes?: string;
  isCompleted: boolean;
  [key: string]: unknown;
}

export interface NewSession {
  courseId: number;
  /**
   * Required non-empty by the server (StudySessionDto/SessionService.Validate) even though
   * CreateAsync immediately re-resolves the real name from courseId and overwrites whatever is
   * sent here - kept only "for backward compatibility". Never omit this: an empty/missing value
   * fails validation with a 400 on every call, regardless of anything else in the request. See
   * runLog.ts's placeholderCourseName for a safe value when nothing better is on hand.
   */
  courseName: string;
  startTime: string;
  endTime: string;
  topic?: string;
  notes?: string;
  timerModeId: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** A hung request would otherwise block the poll loop indefinitely - the extension has no way to
 *  cancel a request it started 30 seconds ago, so it would just pile up behind this one. */
const REQUEST_TIMEOUT_MS = 15_000;
/** One retry, after a short pause, for failures that are plausibly transient (a dropped
 *  connection, our own timeout, a 502 during a deploy, a 429). Everything else - including every
 *  other 4xx - is reported immediately: retrying a wrong API key or a 404 never turns it into a
 *  success. */
const RETRY_DELAY_MS = 500;

function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 429 || error.status >= 500;
  // Anything else thrown by attempt() below is a network-level failure (DNS, TLS, connection
  // reset) or the timeout wrapped below - neither has a response to inspect.
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StudyLifeApi {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    try {
      return await this.attempt<T>(path, init);
    } catch (error) {
      if (!isRetryable(error)) throw error;
      await delay(RETRY_DELAY_MS);
      return this.attempt<T>(path, init);
    }
  }

  private async attempt<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(`${trimBase(this.baseUrl)}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "X-Api-Key": this.apiKey,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `${init?.method ?? "GET"} ${path} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      // 403 is the one worth naming: it means the key authenticated but the endpoint is outside
      // the scopes this installation was granted, which no amount of retrying fixes.
      const hint =
        response.status === 403
          ? " - this installation was not granted that permission; reconnect and approve it"
          : "";
      throw new ApiError(
        `${init?.method ?? "GET"} ${path} failed (${response.status})${hint}`,
        response.status,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  getTimerState(): Promise<TimerState> {
    return this.request<TimerState>("/api/timerstate");
  }

  /**
   * Writes the timer. The server is last-write-wins and answers 200 with the authoritative row
   * rather than 409 (see TimerStateService.SaveAsync), so the returned state - not the one we
   * sent - is what must be rendered afterwards.
   */
  saveTimerState(state: TimerState): Promise<TimerState> {
    return this.request<TimerState>("/api/timerstate", {
      method: "PUT",
      body: JSON.stringify(state),
    });
  }

  getCourses(): Promise<Course[]> {
    return this.request<Course[]>("/api/courses");
  }

  /** Every session, past and future - see StudySession's doc comment. Requires Sessions.GetAll,
   *  a separate scope from Sessions.GetHistory/Sessions.Create. */
  getAllSessions(): Promise<StudySession[]> {
    return this.request<StudySession[]>("/api/sessions");
  }

  getMetricsSummary(): Promise<MetricsSummary> {
    return this.request<MetricsSummary>("/api/metrics/summary");
  }

  /**
   * Hours completed today. Summed here because the metrics API does not carry a daily figure -
   * MetricsHoursDto has week, month and total only. Two days of history are fetched because the
   * window is server-side and day-aligned; the sum below filters to today in local time.
   */
  async getTodayHours(now: number): Promise<number> {
    const history = await this.request<SessionRecord[]>(
      "/api/sessions/history?days=2&onlyCompleted=true",
    );
    return sumHoursOn(history, now);
  }

  createSession(session: NewSession): Promise<unknown> {
    return this.request("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ ...session, isCompleted: true }),
    });
  }
}

/** Split out from the client so the date arithmetic is testable without a server. */
export function sumHoursOn(sessions: SessionRecord[], now: number): number {
  const day = new Date(now);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = start + 86_400_000;
  let ms = 0;
  for (const s of sessions ?? []) {
    if (!s?.startTime || !s?.endTime) continue;
    const from = Date.parse(s.startTime);
    const to = Date.parse(s.endTime);
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) continue;
    // Clipped to the day, so a session spanning midnight counts only its part of today.
    const overlap = Math.min(to, end) - Math.max(from, start);
    if (overlap > 0) ms += overlap;
  }
  return ms / 3_600_000;
}
