// Entry point: wires the poll loop, the status bar, the timer commands and the coding-time
// suggestion together. Deliberately thin - the rules live in the modules it pulls in, which are
// the ones under test.
import * as vscode from "vscode";
import {
  ApiError,
  type Course,
  type MetricsSummary,
  StudyLifeApi,
  type TimerState,
} from "./api.js";
import { ActivityTracker, type Stretch, durationMs, formatDuration } from "./activity.js";
import { LoginError, clearApiKey, readApiKey, runLogin, storeApiKey } from "./auth.js";
import { StatusBar } from "./statusBar.js";
import { StudyLifePanel } from "./panel.js";
import { activeGoals } from "./panelModel.js";
import { transition } from "./timer.js";
import { type TimerRun, decide } from "./runLog.js";

const COURSE_KEY_PREFIX = "studylife.course.";
/** The run this window started, kept in globalState so it survives a window reload -
 *  a focus block easily outlives one. */
const RUN_KEY = "studylife.activeRun";
/** Flow State (52/17) - the closest built-in preset to an uninterrupted coding block. Only used
 *  as the default for a logged stretch; starting the timer sends no mode at all and lets the
 *  server keep whatever the user last chose. */
const DEFAULT_TIMER_MODE_ID = 2;

let api: StudyLifeApi | undefined;
let statusBar: StatusBar;
let panel: StudyLifePanel;
/** Course name for the current workspace, resolved lazily so the sidebar can show it without
 *  an extra request on every poll. */
let workspaceCourseName: string | undefined;
let tracker: ActivityTracker;
let pollTimer: NodeJS.Timeout | undefined;
let lastTimerState: TimerState | undefined;
/** Kept from the last poll so the course picker can offer the active courses without
 *  a second request while the user is waiting on the quick pick. */
let lastMetrics: MetricsSummary | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  statusBar = new StatusBar();
  context.subscriptions.push(statusBar);
  panel = new StudyLifePanel(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(StudyLifePanel.viewType, panel),
  );
  tracker = buildTracker();

  context.subscriptions.push(
    vscode.commands.registerCommand("studylife.connect", () => connect(context)),
    vscode.commands.registerCommand("studylife.disconnect", () => disconnect(context)),
    vscode.commands.registerCommand("studylife.startTimer", () => controlTimer("start", context)),
    vscode.commands.registerCommand("studylife.startTimerWithCourse", () =>
      startTimerWithCourse(context),
    ),
    vscode.commands.registerCommand("studylife.pauseTimer", () => controlTimer("pause", context)),
    vscode.commands.registerCommand("studylife.stopTimer", () => controlTimer("stop", context)),
    vscode.commands.registerCommand("studylife.logCodingTime", () => offerOpenStretch(context)),
    vscode.commands.registerCommand("studylife.setWorkspaceCourse", () =>
      pickWorkspaceCourse(context),
    ),
    vscode.commands.registerCommand("studylife.refresh", () => refresh()),
    vscode.workspace.onDidChangeTextDocument(() => onActivity(context)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("studylife")) void reconfigure(context);
    }),
  );

  await reconfigure(context);
}

export function deactivate(): void {
  if (pollTimer) clearInterval(pollTimer);
}

function buildTracker(): ActivityTracker {
  const config = vscode.workspace.getConfiguration("studylife");
  return new ActivityTracker({
    idleMs: config.get<number>("idleMinutes", 5) * 60_000,
    minimumMs: config.get<number>("minimumSuggestionMinutes", 20) * 60_000,
  });
}

async function reconfigure(context: vscode.ExtensionContext): Promise<void> {
  tracker = buildTracker();
  const config = vscode.workspace.getConfiguration("studylife");
  const instanceUrl = config.get<string>("instanceUrl", "").trim();
  const apiKey = await readApiKey(context);
  api = instanceUrl && apiKey ? new StudyLifeApi(instanceUrl, apiKey) : undefined;

  if (pollTimer) clearInterval(pollTimer);
  const seconds = Math.max(10, config.get<number>("pollSeconds", 30));
  pollTimer = setInterval(() => void refresh(), seconds * 1000);
  await refresh();
}

async function refresh(): Promise<void> {
  if (!api) {
    const now = Date.now();
    statusBar.render({ connected: false, now });
    panel.update({ connected: false, now });
    return;
  }
  try {
    const [timerState, metrics] = await Promise.all([
      api.getTimerState(),
      api.getMetricsSummary(),
    ]);
    lastTimerState = timerState;
    lastMetrics = metrics;
    const snapshot = {
      connected: true,
      timer: timerState,
      metrics,
      tracked: tracker.peek(),
      now: Date.now(),
    };
    statusBar.render(snapshot);
    panel.update({ ...snapshot, courseName: workspaceCourseName });
  } catch (error) {
    // A failed poll is not worth a modal - the status bar going quiet is signal enough, and the
    // next tick may well succeed. A scope problem is the exception: it never fixes itself.
    if (error instanceof ApiError && error.status === 403) {
      void vscode.window.showErrorMessage(`StudyLife: ${error.message}`);
    }
    const now = Date.now();
    statusBar.render({ connected: true, now });
    panel.update({ connected: true, now, courseName: workspaceCourseName });
  }
}

async function connect(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("studylife");
  let instanceUrl = config.get<string>("instanceUrl", "").trim();
  if (!instanceUrl) {
    const entered = await vscode.window.showInputBox({
      title: "StudyLife instance",
      prompt: "Base URL of your StudyLife instance",
      placeHolder: "https://studylife.example.com",
      ignoreFocusOut: true,
    });
    if (!entered) return;
    instanceUrl = entered.trim();
    await config.update("instanceUrl", instanceUrl, vscode.ConfigurationTarget.Global);
  }
  try {
    const apiKey = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "StudyLife: waiting for approval in your browser",
      },
      () => runLogin(instanceUrl),
    );
    await storeApiKey(context, apiKey);
    await reconfigure(context);
    void vscode.window.showInformationMessage("StudyLife: connected.");
  } catch (error) {
    const message = error instanceof LoginError ? error.message : String(error);
    void vscode.window.showErrorMessage(`StudyLife: ${message}`);
  }
}

async function disconnect(context: vscode.ExtensionContext): Promise<void> {
  await clearApiKey(context);
  await reconfigure(context);
  void vscode.window.showInformationMessage(
    "StudyLife: disconnected. The key stays valid on the server until you revoke it there.",
  );
}

async function controlTimer(
  action: "start" | "pause" | "stop",
  context: vscode.ExtensionContext,
  courseId?: number,
): Promise<void> {
  if (!api) {
    void vscode.window.showWarningMessage("StudyLife: not connected yet.");
    return;
  }
  const base = lastTimerState ?? (await api.getTimerState());
  const now = Date.now();
  const next = transition(base, action, {
    now,
    ...(courseId === undefined ? {} : { courseId }),
  });
  try {
    // The server answers with the authoritative row, not an echo - render that, so a transition
    // it resolved differently is visible immediately instead of at the next poll.
    lastTimerState = await api.saveTimerState(next);

    if (action === "start" && courseId !== undefined) {
      const run: TimerRun = {
        courseId,
        startedAt: now,
        sessionId: base?.sessionId ?? null,
        ...(workspaceCourseName === undefined ? {} : { courseName: workspaceCourseName }),
      };
      await context.globalState.update(RUN_KEY, run);
    }
    if (action === "stop") await bookRun(context, base?.sessionId, now);

    await refresh();
  } catch (error) {
    const message = error instanceof ApiError ? error.message : String(error);
    void vscode.window.showErrorMessage(`StudyLife: ${message}`);
  }
}

/**
 * Turns a finished run into a study session, unless StudyLife was already accounting for it.
 * See runLog.ts for why this is the extension's job at all.
 */
async function bookRun(
  context: vscode.ExtensionContext,
  plannedSessionId: number | null | undefined,
  now: number,
): Promise<void> {
  const run = context.globalState.get<TimerRun>(RUN_KEY);
  const decision = decide(run, plannedSessionId, now);
  await context.globalState.update(RUN_KEY, undefined);
  if (!decision.log || !api) return;

  try {
    await api.createSession({
      courseId: decision.courseId,
      startTime: new Date(decision.startedAt).toISOString(),
      endTime: new Date(decision.endedAt).toISOString(),
      timerModeId: lastTimerState?.timerModeId ?? DEFAULT_TIMER_MODE_ID,
      ...(run?.courseName === undefined ? {} : { topic: run.courseName }),
    });
    const label = formatDuration(decision.endedAt - decision.startedAt);
    void vscode.window.showInformationMessage(
      `StudyLife: logged ${label}${run?.courseName ? ` for ${run.courseName}` : ""}.`,
    );
  } catch (error) {
    // Losing the session silently would be the worst outcome - the user stopped a timer they
    // believed was being recorded.
    const message = error instanceof ApiError ? error.message : String(error);
    void vscode.window.showErrorMessage(`StudyLife: the session could not be saved - ${message}`);
  }
}

/**
 * Starts the timer after asking which course it is for. Offered only while the timer is stopped -
 * changing the course of a session already under way would silently re-attribute time that has
 * already been spent, and that history feeds the grade and ECTS correlations.
 */
async function startTimerWithCourse(context: vscode.ExtensionContext): Promise<void> {
  if (!api) {
    void vscode.window.showWarningMessage("StudyLife: not connected yet.");
    return;
  }
  const courseId = await pickCourse("Start a focus session for");
  if (courseId === undefined) return;
  await controlTimer("start", context, courseId);
  await rememberCourseName(context, courseId);
}

function onActivity(context: vscode.ExtensionContext): void {
  if (!vscode.workspace.getConfiguration("studylife").get<boolean>("trackCodingTime", true)) return;
  const finished = tracker.noteActivity(Date.now());
  if (finished && tracker.isWorthOffering(finished)) void offerStretch(context, finished);
}

async function offerOpenStretch(context: vscode.ExtensionContext): Promise<void> {
  const open = tracker.flush();
  if (!open) {
    void vscode.window.showInformationMessage("StudyLife: nothing tracked in this window yet.");
    return;
  }
  await offerStretch(context, open);
}

/** Always asks. See the note at the top of activity.ts for why this is never silent. */
async function offerStretch(context: vscode.ExtensionContext, stretch: Stretch): Promise<void> {
  if (!api) return;
  const label = formatDuration(durationMs(stretch));
  const workspace = vscode.workspace.name ?? "this workspace";
  const choice = await vscode.window.showInformationMessage(
    `StudyLife: ${label} of editing in ${workspace}. Log it as a study session?`,
    "Log it",
    "Discard",
  );
  if (choice !== "Log it") return;

  const courseId = await resolveCourse(context);
  if (courseId === undefined) return;
  try {
    await api.createSession({
      courseId,
      startTime: new Date(stretch.startedAt).toISOString(),
      endTime: new Date(stretch.lastActivityAt).toISOString(),
      topic: workspace,
      timerModeId: DEFAULT_TIMER_MODE_ID,
    });
    void vscode.window.showInformationMessage(`StudyLife: logged ${label}.`);
    await refresh();
  } catch (error) {
    const message = error instanceof ApiError ? error.message : String(error);
    void vscode.window.showErrorMessage(`StudyLife: ${message}`);
  }
}

/** The workspace-to-course mapping is remembered, so the question is asked once per workspace. */
async function resolveCourse(context: vscode.ExtensionContext): Promise<number | undefined> {
  const remembered = context.globalState.get<number>(workspaceKey());
  if (remembered !== undefined) return remembered;
  return pickWorkspaceCourse(context);
}

/**
 * The course picker. Offers the courses with an open goal first - StudyLife has no "active" flag,
 * but an uncompleted course goal is exactly "a course I am working towards", and the built-in
 * catalogue alone carries around sixty entries, which is an unusable list to start a session from.
 * The full catalogue stays one click away rather than being hidden.
 */
async function pickCourse(title: string): Promise<number | undefined> {
  if (!api) {
    void vscode.window.showWarningMessage("StudyLife: not connected yet.");
    return undefined;
  }

  const active = activeGoals(lastMetrics);
  if (active.length > 0) {
    const SHOW_ALL = -1;
    const picked = await vscode.window.showQuickPick(
      [
        ...active.map((g) => ({
          label: g.courseName,
          description: g.daysLeft < 0 ? `${Math.abs(g.daysLeft)} days overdue` : `in ${g.daysLeft} days`,
          id: g.courseId,
        })),
        { label: "$(list-unordered) All courses…", description: "", id: SHOW_ALL },
      ],
      { title, ignoreFocusOut: true, matchOnDescription: true },
    );
    if (!picked) return undefined;
    if (picked.id !== SHOW_ALL) return picked.id;
  }

  return pickFromFullCatalogue(title);
}

async function pickFromFullCatalogue(title: string): Promise<number | undefined> {
  let courses: Course[];
  try {
    courses = (await api?.getCourses()) ?? [];
  } catch (error) {
    void vscode.window.showErrorMessage(`StudyLife: ${String(error)}`);
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    courses.map((c) => ({
      label: c.name,
      description: c.semester === undefined ? "" : `Semester ${c.semester}`,
      id: c.id,
    })),
    { title, ignoreFocusOut: true, matchOnDescription: true },
  );
  return picked?.id;
}

async function pickWorkspaceCourse(
  context: vscode.ExtensionContext,
): Promise<number | undefined> {
  const id = await pickCourse(`Course for ${vscode.workspace.name ?? "this workspace"}`);
  if (id === undefined) return undefined;
  await context.globalState.update(workspaceKey(), id);
  await rememberCourseName(context, id);
  return id;
}

/** Resolves the id to a name once, so the sidebar can show it without a request per poll. */
async function rememberCourseName(
  context: vscode.ExtensionContext,
  courseId: number,
): Promise<void> {
  try {
    const courses = await api?.getCourses();
    workspaceCourseName = courses?.find((c) => c.id === courseId)?.name;
  } catch {
    // A name we cannot resolve is not worth an error to the user - the sidebar falls back to
    // "not set" and everything else keeps working.
    workspaceCourseName = undefined;
  }
  await refresh();
}

function workspaceKey(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? "none";
  return `${COURSE_KEY_PREFIX}${folder}`;
}
