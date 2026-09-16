// Entry point: wires the poll loop, the status bar, the timer commands and the coding-time
// suggestion together. Deliberately thin - the rules live in the modules it pulls in, which are
// the ones under test.
import * as vscode from "vscode";
import { ApiError, type Course, StudyLifeApi, type TimerState } from "./api.js";
import { ActivityTracker, type Stretch, durationMs, formatDuration } from "./activity.js";
import { LoginError, clearApiKey, readApiKey, runLogin, storeApiKey } from "./auth.js";
import { StatusBar } from "./statusBar.js";
import { StudyLifeTreeProvider } from "./sidebar.js";

const COURSE_KEY_PREFIX = "studylife.course.";
/** Flow State (52/17) - the closest built-in preset to an uninterrupted coding block. Only used
 *  as the default for a logged stretch; starting the timer sends no mode at all and lets the
 *  server keep whatever the user last chose. */
const DEFAULT_TIMER_MODE_ID = 2;

let api: StudyLifeApi | undefined;
let statusBar: StatusBar;
let tree: StudyLifeTreeProvider;
/** Course name for the current workspace, resolved lazily so the sidebar can show it without
 *  an extra request on every poll. */
let workspaceCourseName: string | undefined;
let tracker: ActivityTracker;
let pollTimer: NodeJS.Timeout | undefined;
let lastTimerState: TimerState | undefined;
/** Monotonic per-window counter. The server drops a PUT whose ClientSequence is older than the
 *  one it already stored, which is what keeps two rapid transitions from landing reversed. */
let clientSequence = 0;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  statusBar = new StatusBar();
  context.subscriptions.push(statusBar);
  tree = new StudyLifeTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("studylife.overview", tree),
  );
  tracker = buildTracker();

  context.subscriptions.push(
    vscode.commands.registerCommand("studylife.connect", () => connect(context)),
    vscode.commands.registerCommand("studylife.disconnect", () => disconnect(context)),
    vscode.commands.registerCommand("studylife.startTimer", () => controlTimer("start")),
    vscode.commands.registerCommand("studylife.startTimerWithCourse", () =>
      startTimerWithCourse(context),
    ),
    vscode.commands.registerCommand("studylife.pauseTimer", () => controlTimer("pause")),
    vscode.commands.registerCommand("studylife.stopTimer", () => controlTimer("stop")),
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
    tree.update({ connected: false, now });
    return;
  }
  try {
    const [timerState, metrics] = await Promise.all([
      api.getTimerState(),
      api.getMetricsSummary(),
    ]);
    lastTimerState = timerState;
    const snapshot = {
      connected: true,
      timer: timerState,
      metrics,
      tracked: tracker.peek(),
      now: Date.now(),
    };
    statusBar.render(snapshot);
    tree.update({ ...snapshot, courseName: workspaceCourseName });
  } catch (error) {
    // A failed poll is not worth a modal - the status bar going quiet is signal enough, and the
    // next tick may well succeed. A scope problem is the exception: it never fixes itself.
    if (error instanceof ApiError && error.status === 403) {
      void vscode.window.showErrorMessage(`StudyLife: ${error.message}`);
    }
    const now = Date.now();
    statusBar.render({ connected: true, now });
    tree.update({ connected: true, now, courseName: workspaceCourseName });
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
  courseId?: number,
): Promise<void> {
  if (!api) {
    void vscode.window.showWarningMessage("StudyLife: not connected yet.");
    return;
  }
  clientSequence += 1;
  const base = lastTimerState ?? (await api.getTimerState());
  const next: TimerState = {
    ...base,
    isRunning: action !== "stop",
    isPaused: action === "pause",
    clientSequence,
    ...(courseId === undefined ? {} : { courseId }),
  };
  try {
    // The server answers with the authoritative row, not an echo - render that, so a transition
    // it resolved differently is visible immediately instead of at the next poll.
    lastTimerState = await api.saveTimerState(next);
    await refresh();
  } catch (error) {
    const message = error instanceof ApiError ? error.message : String(error);
    void vscode.window.showErrorMessage(`StudyLife: ${message}`);
  }
}

/**
 * Starts the timer after asking which course it is for. Offered only while the timer is stopped -
 * changing the course of a session already under way would silently re-attribute time that has
 * already been spent, and that history feeds the grade correlations.
 */
async function startTimerWithCourse(context: vscode.ExtensionContext): Promise<void> {
  if (!api) {
    void vscode.window.showWarningMessage("StudyLife: not connected yet.");
    return;
  }
  const courseId = await pickCourse("Start a focus session for");
  if (courseId === undefined) return;
  await controlTimer("start", courseId);
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

/** The course picker on its own, so both the workspace mapping and the timer start can use it. */
async function pickCourse(title: string): Promise<number | undefined> {
  if (!api) {
    void vscode.window.showWarningMessage("StudyLife: not connected yet.");
    return undefined;
  }
  let courses: Course[];
  try {
    courses = await api.getCourses();
  } catch (error) {
    void vscode.window.showErrorMessage(`StudyLife: ${String(error)}`);
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    courses.map((c) => ({ label: c.name, id: c.id })),
    { title, ignoreFocusOut: true },
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
