// The Activity Bar panel. A WebviewView rather than a TreeView: a tree has a fixed row height,
// no way to space sections apart and no progress bar, which is exactly what this view needed.
//
// Everything is styled from VS Code's own theme variables, so it follows whatever theme the user
// runs without a palette of its own. What to show lives in panelModel.ts.
import * as vscode from "vscode";
import { escapeHtml as escape } from "./html.js";
import { type PanelModel, type Snapshot, buildPanel } from "./panelModel.js";

export class StudyLifePanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "studylife.panel";

  private view: vscode.WebviewView | undefined;
  private snapshot: Snapshot = { connected: false, now: Date.now() };
  private ticker: NodeJS.Timeout | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    // No scripts from disk and no network: the only script is the inline one below, pinned by a
    // nonce. localResourceRoots stays on the extension folder even though nothing is loaded from
    // it, so a later asset cannot widen this by accident.
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    view.webview.onDidReceiveMessage((message: { command?: string }) => {
      if (typeof message?.command === "string")
        void vscode.commands.executeCommand(message.command);
    });

    // The countdown has to move on its own - the poll loop runs every 30 seconds, which would
    // make a seconds display sit still and look broken. Only while the view is visible.
    const retick = (): void => {
      if (this.ticker) clearInterval(this.ticker);
      this.ticker = view.visible
        ? setInterval(() => {
            this.snapshot = { ...this.snapshot, now: Date.now() };
            this.render();
          }, 1000)
        : undefined;
    };
    view.onDidChangeVisibility(retick);
    view.onDidDispose(() => {
      if (this.ticker) clearInterval(this.ticker);
      this.ticker = undefined;
      this.view = undefined;
    });
    retick();
    this.render();
  }

  update(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    this.view.webview.html = html(buildPanel(this.snapshot), nonce());
  }
}

function nonce(): string {
  return Array.from({ length: 24 }, () =>
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
      Math.floor(Math.random() * 62),
    ),
  ).join("");
}

function html(m: PanelModel, n: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<style>
  :root {
    --gap: 16px;
    --radius: 6px;
  }
  body {
    padding: var(--gap) 14px 20px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
  }
  .card {
    background: var(--vscode-editorWidget-background, rgba(127,127,127,.08));
    border: 1px solid var(--vscode-editorWidget-border, transparent);
    border-radius: var(--radius);
    padding: 14px;
    margin-bottom: 22px;
  }
  .phase {
    display: flex; align-items: center; gap: 7px;
    font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-descriptionForeground); }
  .dot.live { background: var(--vscode-charts-green, #3fb950); }
  .countdown {
    font-size: 30px; font-weight: 300; letter-spacing: .01em;
    font-variant-numeric: tabular-nums; margin: 10px 0 4px;
  }
  .sub { font-size: 12px; color: var(--vscode-descriptionForeground); }
  .sub .pick { cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
  .sub .pick:hover { color: var(--vscode-textLink-foreground); }
  /* The bar: determinate when the mode length is known, a sweep when it is not. Never a
     made-up fraction - see panelModel.buildPanel. */
  .track {
    height: 4px; border-radius: 2px; margin: 14px 0 2px; overflow: hidden;
    background: var(--vscode-progressBar-background, rgba(127,127,127,.25)); opacity: .35;
  }
  .track .fill {
    height: 100%; border-radius: 2px;
    background: var(--vscode-progressBar-background, #0078d4);
  }
  .track.live { opacity: 1; }
  .track.indeterminate .fill { width: 35%; animation: sweep 1.9s ease-in-out infinite; }
  @keyframes sweep { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
  .actions { display: flex; gap: 8px; margin-top: 14px; }
  button {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 6px 10px; border: none; border-radius: var(--radius); cursor: pointer;
    font-family: inherit; font-size: 12px;
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.18));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  button.primary {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,.3)); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  h2 {
    font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground); margin: 0 0 10px;
  }
  .stats { display: flex; gap: 8px; margin-bottom: 22px; }
  .stat { flex: 1; }
  .stat .v { font-size: 15px; font-variant-numeric: tabular-nums; }
  .stat .l {
    font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
    color: var(--vscode-descriptionForeground); margin-top: 3px;
  }
  .row {
    display: flex; justify-content: space-between; gap: 10px;
    padding: 7px 0; border-top: 1px solid var(--vscode-widget-border, rgba(127,127,127,.15));
  }
  .row:first-of-type { border-top: none; }
  /* Both halves may shrink: a course name like "Projekt: Objektorientierte und funktionale
     Programmierung mit Python" is longer than the whole panel is wide, and flex-shrink: 0 on the
     value pushed the row past its edge instead of truncating. The label keeps a floor so it never
     collapses to nothing. */
  .row .k {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 0 0 auto; min-width: 3.5em;
  }
  .row .v {
    color: var(--vscode-descriptionForeground); font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1 1 auto; text-align: right; min-width: 0;
  }
  .row .v.overdue { color: var(--vscode-errorForeground); }
  /* Goal rows are the reverse: the course name is the long half, the countdown is short. */
  .row.goal .k { flex: 1 1 auto; min-width: 0; }
  .row.goal .v { flex: 0 0 auto; }
  .row.click { cursor: pointer; }
  .row.click:hover { color: var(--vscode-textLink-foreground); }
  .empty { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 4px 0; }
  section { margin-bottom: 22px; }
  section:last-child { margin-bottom: 0; }
</style>
</head>
<body>
${m.connected ? connected(m) : disconnected()}
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  for (const el of document.querySelectorAll('[data-command]')) {
    el.addEventListener('click', () => vscode.postMessage({ command: el.dataset.command }));
  }
</script>
</body>
</html>`;
}

function disconnected(): string {
  return `<div class="card">
  <div class="phase"><span class="dot"></span>Not connected</div>
  <div class="sub" style="margin-top:8px">Connect to your StudyLife instance to see your timer and study time here.</div>
  <div class="actions"><button class="primary" data-command="studylife.connect">Connect</button></div>
</div>`;
}

function connected(m: PanelModel): string {
  const t = m.timer;
  const bar = t.running
    ? t.progress === undefined
      ? `<div class="track live indeterminate"><div class="fill"></div></div>`
      : `<div class="track live"><div class="fill" style="width:${Math.round(t.progress * 100)}%"></div></div>`
    : `<div class="track"><div class="fill" style="width:0%"></div></div>`;

  // The mode is its own clickable element, and shows even when unset - otherwise the only way to
  // discover that the preset is choosable would be the command palette.
  const modeLabel = t.mode ?? "Choose mode";
  const modePart = t.canChangeMode
    ? `<span class="pick" data-command="studylife.setTimerMode">${escape(modeLabel)}</span>`
    : escape(modeLabel);
  const meta = [modePart, t.round ? escape(t.round) : ""].filter((x) => x.length > 0).join(" · ");

  const actions = t.running
    ? `<button data-command="studylife.pauseTimer">Pause</button>
       <button data-command="studylife.stopTimer">Stop</button>`
    : t.paused
      ? `<button class="primary" data-command="studylife.startTimer">Resume</button>
         <button data-command="studylife.stopTimer">Stop</button>`
      : `<button class="primary" data-command="studylife.startTimerWithCourse">Start session</button>`;

  const goals = m.goals.length
    ? m.goals
        .map(
          (g) =>
            `<div class="row goal"><span class="k">${escape(g.name)}</span><span class="v${g.overdue ? " overdue" : ""}">${escape(g.due)}</span></div>`,
        )
        .join("")
    : `<div class="empty">No open course goals.</div>`;

  return `<div class="card">
  <div class="phase"><span class="dot${t.running ? " live" : ""}"></span>${escape(t.phase)}</div>
  <div class="countdown">${escape(t.countdown ?? "--:--")}</div>
  <div class="sub">${meta}</div>
  ${bar}
  <div class="actions">${actions}</div>
</div>

<section>
  <div class="stats">
    ${m.stats.map((s) => `<div class="stat"><div class="v">${escape(s.value)}</div><div class="l">${escape(s.label)}</div></div>`).join("")}
  </div>
</section>

<section>
  <h2>Open goals</h2>
  ${goals}
</section>

<section>
  <h2>This workspace</h2>
  <div class="row click" data-command="studylife.setWorkspaceCourse">
    <span class="k">Course</span><span class="v">${escape(m.courseName ?? "not set")}</span>
  </div>
  ${
    m.tracked
      ? `<div class="row click" data-command="studylife.logCodingTime">
           <span class="k">Tracked</span><span class="v">${escape(m.tracked)}</span>
         </div>`
      : ""
  }
</section>`;
}
