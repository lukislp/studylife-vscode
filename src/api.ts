// Typed client for exactly the six endpoints this extension is scoped for. Every method maps to
// one entry the client requests at registration; adding a call here means adding the scope there
// (and having it be publicly grantable server-side), never the other way round.
import { trimBase } from "./oauth.js";

export interface TimerState {
  isRunning: boolean;
  isPaused?: boolean;
  courseId?: number;
  timerModeId?: number;
  clientSequence?: number;
  [key: string]: unknown;
}

export interface Course {
  id: number;
  name: string;
  color?: string;
}

export interface UpcomingGoal {
  courseId: number;
  courseName: string;
  targetDate: string;
  daysLeft: number;
}

export interface MetricsSummary {
  streak?: { current?: number };
  hours?: { today?: number; week?: number };
  upcomingCourseGoals?: UpcomingGoal[];
  [key: string]: unknown;
}

export interface NewSession {
  courseId: number;
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

export class StudyLifeApi {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${trimBase(this.baseUrl)}${path}`, {
      ...init,
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      // 403 is the one worth naming: it means the key authenticated but the endpoint is outside
      // the scopes this installation was granted, which no amount of retrying fixes.
      const hint =
        response.status === 403
          ? " - this installation was not granted that permission; reconnect and approve it"
          : "";
      throw new ApiError(`${init?.method ?? "GET"} ${path} failed (${response.status})${hint}`, response.status);
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

  getMetricsSummary(): Promise<MetricsSummary> {
    return this.request<MetricsSummary>("/api/metrics/summary");
  }

  createSession(session: NewSession): Promise<unknown> {
    return this.request("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ ...session, isCompleted: true }),
    });
  }
}
