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
import { LatestWins } from "./sequencer.js";
import { canChangeMode, modeChoices, remainingMs, transition } from "./timer.js";
import { type TimerRun, decide, placeholderCourseName } from "./runLog.js";

const COURSE_KEY_PREFIX = "studylife.course.";
/** The run this window started, kept in globalState so it survives a window reload -
 *  a focus block easily outlives one. */
const RUN_KEY = "studylife.activeRun";
/** Milliseconds left when the timer was paused. The wire shape cannot carry this - see
 *  TransitionOptions.resumeMs - so the remainder would otherwise be lost on every pause. */
const RESUME_KEY = "studylife.resumeMs";
/** The preset to start with. Kept locally because a stopped timer still carries the last
 *  mode on the server, and writing one just to remember a preference would be a visible
 *  state change for every other device. */
const MODE_KEY = "studylife.timerMode";
/** Flow State (52/17) - the closest built-in preset to an uninterrupted coding block. Only used
 *  as the default for a logged stretch; starting the timer sends no mode at all and lets the
 *  server keep whatever the user last chose. */
const DEFAULT_TIMER_MODE_ID = 2;
/** Floor for the poll interval. Mirrors configuration.properties["studylife.pollSeconds"].minimum
 *  in package.json - VS Code's settings schema only validates the Settings UI and settings.json
 *  editing, not a value read back via config.get(), so this clamp is the actual enforcement. Keep
 *  both in sync by hand if either changes. */
const MIN_POLL_SECONDS = 10;
/** Consecutive failed polls before a non-403 failure is worth a popup. One blip (a dropped wifi
 *  packet, a deploy restart) is not - the next tick usually recovers on its own. A sustained
 *  outage (wrong instanceUrl, DNS failure, the server being down) otherwise never surfaces
 *  anything beyond the status bar quietly going blank, which reads as "broken" rather than
 *  "reconnecting". */
const FAILURE_NOTIFY_THRESHOLD = 2;

let api: StudyLifeApi | undefined;
let statusBar: StatusBar;
let panel: StudyLifePanel;
/** Kept so refresh() - which polls on a timer, not just after a command - can read RESUME_KEY
 *  without every caller having to thread the extension context through. */
let extensionContext: vscode.ExtensionContext | undefined;
/** Course name for the current workspace, resolved lazily so the sidebar can show it without
 *  an extra request on every poll. */
let workspaceCourseName: string | undefined;
let tracker: ActivityTracker;
let pollTimer: NodeJS.Timeout | undefined;
let lastTimerState: TimerState | undefined;
/** Guards writes to lastTimerState (and the render calls derived from it) against the periodic
 *  poll and a command's own save racing each other - see sequencer.ts's doc comment for exactly
 *  the bug this prevents: a poll issued just before a Pause/Start/Stop click, but resolving just
 *  after that click's own save, would otherwise overwrite the freshly saved state with the
 *  stale one it already had in hand. */
const timerStateSeq = new LatestWins();
/** Kept from the last poll so the course picker can offer the active courses without
 *  a second request while the user is waiting on the quick pick. */
let lastMetrics: MetricsSummary | undefined;
/** Tracks an in-progress outage so the non-403 warning below fires once per outage, not once per
 *  poll. Reset on the next successful refresh. */
let consecutivePollFailures = 0;
let notifiedThisOutage = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;
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
    vscode.commands.registerCommand("studylife.setTimerMode", () => pickTimerMode(context)),
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
  const seconds = Math.max(MIN_POLL_SECONDS, config.get<number>("pollSeconds", 30));
  pollTimer = setInterval(() => void refresh(), seconds * 1000);
  await refresh();
}

/**
 * Milliseconds left when *this window* paused the timer (RESUME_KEY), or undefined when it did
 * not. The wire has no paused flag - a paused session and a stopped one both come back as
 * `isRunning: false` - so this is the only place that distinction can come from, and only for
 * as long as this window is the one still holding it. Gated on `timerState` actually being
 * stopped so a stale RESUME_KEY (there should not be one - see controlTimer - but poll timing is
 * not something to bet display correctness on) never overrides a state that is genuinely
 * running.
 */
function pausedRemainingMs(timerState: TimerState | undefined): number | undefined {
  const resumeMs = extensionContext?.globalState.get<number>(RESUME_KEY);
  return resumeMs !== undefined && timerState?.isRunning !== true ? resumeMs : undefined;
}

/**
 * Renders just the timer state, immediately, from a value already in hand - no network round
 * trip of its own. Used right after a save resolves, so Start/Pause/Resume show the correct
 * countdown without waiting for refresh()'s slower metrics/today's-hours/every-session-ever
 * round trip too - see controlTimer's call site for why that wait was visible as several
 * seconds vanishing. Metrics/sessions keep showing whatever refresh() last fetched until its own
 * call, right after this one, catches up and repaints everything again.
 */
function renderTimerImmediately(state: TimerState, now: number): void {
  const pausedMs = pausedRemainingMs(state);
  const snapshot = { connected: true, timer: state, metrics: lastMetrics, tracked: tracker.peek(), now };
  statusBar.render({ ...snapshot, pausedLocally: pausedMs !== undefined });
  panel.update({
    ...snapshot,
    courseName: workspaceCourseName,
    ...(pausedMs === undefined ? {} : { pausedRemainingMs: pausedMs }),
  });
}

async function refresh(): Promise<void> {
  if (!api) {
    const now = Date.now();
    statusBar.render({ connected: false, now });
    panel.update({ connected: false, now });
    return;
  }
  // Reserved before any await, so a command that starts after this poll (e.g. the user clicking
  // Pause) is guaranteed a higher ticket - see sequencer.ts. Whichever of this poll or that
  // command's own save resolves last no longer matters; only the one issued last is allowed to
  // apply its result below.
  const ticket = timerStateSeq.start();
  try {
    const now = Date.now();
    // The daily figure is summed from the session history: MetricsHoursDto has week, month and
    // total, but no today. Sessions.GetAll needs its own scope this installation may not have
    // been granted. Neither failure must blank the rest of the panel.
    const [timerState, metrics, todayHours, sessions] = await Promise.all([
      api.getTimerState(),
      api.getMetricsSummary(),
      api.getTodayHours(now).catch(() => undefined),
      api.getAllSessions().catch(() => undefined),
    ]);
    if (!timerStateSeq.isCurrent(ticket)) return; // superseded by a newer poll or command
    lastTimerState = timerState;
    lastMetrics = metrics;
    consecutivePollFailures = 0;
    notifiedThisOutage = false;
    const pausedMs = pausedRemainingMs(timerState);
    const snapshot = {
      connected: true,
      timer: timerState,
      metrics,
      tracked: tracker.peek(),
      ...(todayHours === undefined ? {} : { todayHours }),
      ...(sessions === undefined ? {} : { sessions }),
      now,
    };
    statusBar.render({ ...snapshot, pausedLocally: pausedMs !== undefined });
    panel.update({
      ...snapshot,
      courseName: workspaceCourseName,
      ...(pausedMs === undefined ? {} : { pausedRemainingMs: pausedMs }),
    });
  } catch (error) {
    if (!timerStateSeq.isCurrent(ticket)) return; // superseded - do not render this stale outcome
    // A single failed poll is not worth a modal - the status bar going quiet is signal enough,
    // and the next tick may well succeed. A scope problem is the exception: it never fixes
    // itself, so it is always worth saying. Everything else only gets a message once it looks
    // like a real outage rather than a blip - see FAILURE_NOTIFY_THRESHOLD.
    consecutivePollFailures += 1;
    if (error instanceof ApiError && error.status === 403) {
      void vscode.window.showErrorMessage(`StudyLife: ${error.message}`);
    } else if (consecutivePollFailures >= FAILURE_NOTIFY_THRESHOLD && !notifiedThisOutage) {
      notifiedThisOutage = true;
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(`StudyLife: can't reach the server - ${message}`);
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
  // Reserved as early as possible - right at the click, before this action's own await gap
  // opens - so a poll already in flight is guaranteed to have the smaller ticket and lose the
  // race in timerStateSeq below, no matter which of the two network calls answers first.
  const ticket = timerStateSeq.start();
  const base = lastTimerState ?? (await api.getTimerState());
  const now = Date.now();
  const resumeMs = context.globalState.get<number>(RESUME_KEY);
  const next = transition(base, action, {
    now,
    ...(courseId === undefined ? {} : { courseId }),
    ...(action === "start" && resumeMs !== undefined ? { resumeMs } : {}),
  });
  try {
    // The server answers with the authoritative row, not an echo - render that, so a transition
    // it resolved differently is visible immediately instead of at the next poll.
    // Captured from the state as it stood BEFORE the write, which is the only moment the
    // remainder still exists anywhere.
    if (action === "pause") {
      await context.globalState.update(RESUME_KEY, remainingMs(base, now));
    } else {
      await context.globalState.update(RESUME_KEY, undefined);
    }

    const saved = await api.saveTimerState(next);
    // Only commit if nothing newer (another command, or a poll started after this click) has
    // since taken over - see sequencer.ts. refresh() below issues its own, always-newer ticket
    // and re-fetches the authoritative state regardless, so skipping this write when superseded
    // never leaves the UI stuck on stale data.
    if (timerStateSeq.isCurrent(ticket)) {
      lastTimerState = saved;
      // Render the countdown right now, from what the save just answered - not once refresh()
      // below has *also* round-tripped for metrics/today's hours/every session ever (Sessions.
      // GetAll is unbounded, see api.ts), which on a slower connection took long enough that the
      // very next render already looked like several seconds had vanished the moment Start,
      // Pause or Resume was pressed. remainingMs(saved, now) is exact - now was captured before
      // the save's own network round trip, so it does not itself drift while awaiting.
      renderTimerImmediately(saved, now);
    }

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

  if (!decision.log) {
    // Never silent. Stopping a timer and getting nothing, with no word about why, is
    // indistinguishable from the feature being broken - which is exactly how it read the first
    // time a short run was dropped.
    if (decision.reason === "too-short" && run) {
      const label = formatDuration(now - run.startedAt);
      void vscode.window.showInformationMessage(
        `StudyLife: ${label} was too short to record as a session.`,
      );
    } else if (decision.reason === "no-run") {
      void vscode.window.showInformationMessage(
        "StudyLife: nothing recorded - this window did not start the session, so it has no course or start time to book.",
      );
    }
    // "planned" stays quiet on purpose: StudyLife is already accounting for that time, so
    // there is nothing the user needs to do or know.
    return;
  }
  if (!api) return;

  try {
    await api.createSession({
      courseId: decision.courseId,
      // Required non-empty by the server even though it derives and overwrites the real name
      // from courseId itself - see runLog.ts's placeholderCourseName for why this can never be
      // left out.
      courseName: placeholderCourseName(decision.courseId, run?.courseName),
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
      courseName: placeholderCourseName(courseId, workspaceCourseName),
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
          description:
            g.daysLeft < 0 ? `${Math.abs(g.daysLeft)} days overdue` : `in ${g.daysLeft} days`,
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

async function pickWorkspaceCourse(context: vscode.ExtensionContext): Promise<number | undefined> {
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

/**
 * Picks the focus preset. Only the built-in nine are offered - custom modes live in the user's
 * StudyLife settings, which this extension cannot read, so it can neither name nor time them.
 */
async function pickTimerMode(context: vscode.ExtensionContext): Promise<void> {
  if (!canChangeMode(lastTimerState)) {
    void vscode.window.showWarningMessage(
      "StudyLife: stop the timer before changing the mode - the running countdown is measured against the current length.",
    );
    return;
  }
  const remembered = context.globalState.get<number>(MODE_KEY);
  const picked = await vscode.window.showQuickPick(
    modeChoices(lastTimerState).map((m) => ({
      label: m.current || m.id === remembered ? `$(check) ${m.name}` : m.name,
      description: m.detail,
      id: m.id,
    })),
    { title: "Focus mode for the next session", ignoreFocusOut: true, matchOnDescription: true },
  );
  if (!picked) return;
  await context.globalState.update(MODE_KEY, picked.id);
  // Written through immediately so the panel and every other device show the new preset rather
  // than only finding out when the next session starts.
  if (api && lastTimerState) {
    try {
      lastTimerState = await api.saveTimerState({ ...lastTimerState, timerModeId: picked.id });
    } catch {
      // A failed write is not worth an error here - the preference is stored locally and the
      // next start carries it anyway.
    }
  }
  await refresh();
}

function workspaceKey(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? "none";
  return `${COURSE_KEY_PREFIX}${folder}`;
}
