# StudyLife for VS Code

[![CI](https://github.com/lukislp/studylife-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/lukislp/studylife-vscode/actions/workflows/ci.yml) [![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/lukislp/studylife-vscode?label=openssf+scorecard&style=flat)](https://scorecard.dev/viewer/?uri=github.com/lukislp/studylife-vscode) [![CodeQL](https://github.com/lukislp/studylife-vscode/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/lukislp/studylife-vscode/security/code-scanning)
[![Release](https://img.shields.io/github/v/release/lukislp/studylife-vscode)](https://github.com/lukislp/studylife-vscode/releases)
[![License: AGPL-3.0](https://img.shields.io/github/license/lukislp/studylife-vscode)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](https://www.typescriptlang.org/)

Control your [StudyLife](https://github.com/lukislp/studylife) focus timer from the editor, and
turn the time you actually spend coding into study sessions.

For a computer science degree, the editor is where most of the study time goes — and it is the one
place StudyLife could not see. This extension closes that gap from both ends: the timer becomes
reachable without leaving the keyboard, and finished coding stretches can be logged against a
course instead of being lost.

## What it does

**In the sidebar** — a StudyLife icon in the Activity Bar opens a panel with a timer card at the
top: the phase, a large countdown, the mode and round, and a progress bar through the current
focus or break block. **Start, pause and stop are buttons in the card.** Below it sit today's and
this week's hours with your streak, your open course goals with their countdowns, and this
workspace's course and tracked time.

The progress bar is only ever determinate when the length is actually known. Custom timer modes
live in your StudyLife settings, which this extension has no scope to read, so for those the bar
sweeps instead of claiming a fraction it cannot compute.

A paused session reads **Paused**, with the remaining time frozen where you left it — not
**Stopped**. StudyLife's server has no paused state of its own (pausing and stopping both just
turn the timer off), so this extension remembers the pause itself for as long as this window is
open, and shows it as its own state instead of rendering it identically to a real stop. The status
bar's tooltip makes the same distinction.

Starting from the panel asks **which course** the session is for, and offers only the courses you
are currently working towards — those with an open course goal. StudyLife has no "active" flag on
a course and the built-in catalogue alone carries around sixty, which is an unusable list to pick
from. The full catalogue stays one click away. The question is offered only while the timer is
stopped: changing the course of a session already under way would silently re-attribute time that
has already been spent, and that history feeds StudyLife's grade and ECTS correlations.

**The timer books its own time.** StudyLife's timer does not record anything by itself — the web
app attaches it to a session the planner already created, and the timer state carries neither a
course nor a start time. So when you start a session here and nothing was planned for that slot,
the extension remembers what it started and writes the session when you stop, for the course you
picked. If a planned session *was* attached, nothing is written: StudyLife is already accounting
for that time, and a second row would double-count it in the history the grade correlations are
computed from. Runs under a minute are dropped as mis-clicks.

**In the status bar** — today's study time, or a recording dot while a focus session runs. The
tooltip adds this week's hours, your streak, and the next course goal with its countdown. Every
number comes from StudyLife's own metrics endpoint, the single place those are calculated, so the
status bar can never quietly disagree with the web app.

**Timer control** — start, pause and stop the focus timer from the command palette. The timer is
shared across every device, so a session started here shows up in the web app, the tray app and
Home Assistant alike, and vice versa.

**Coding time, as a suggestion** — editing activity is tracked per workspace. When a stretch ends,
the extension *offers* to log it:

> StudyLife: 2 h 14 min of editing in `betriebssysteme-uebung`. Log it as a study session?

It never records silently. A wrongly attributed block would land in the same session history
StudyLife correlates against grades and ECTS, so a bad guess would not just add noise — it would
quietly distort an analysis you rely on. You confirm the block and the course; the workspace's
course is remembered after the first time.

## Requirements

- A self-hosted StudyLife instance you can reach from this machine
- VS Code 1.90 or newer
- The client registered once on your instance (see below)

## Setup

### 1. Register the client on your instance

This extension authenticates as a dynamically registered OAuth client, so it has to be registered
once per instance through [studylife-developers](https://github.com/lukislp/studylife-developers):

| Field | Value |
| --- | --- |
| Client ID | `studylife-vscode` |
| Redirect URIs | `http://127.0.0.1:8775/callback`, `http://127.0.0.1:8776/callback`, `http://127.0.0.1:8777/callback`, `http://127.0.0.1:8778/callback` |
| Scopes | `TimerState.Get`, `TimerState.Save`, `Sessions.Create`, `Sessions.GetHistory`, `Courses.GetAll`, `Metrics.GetSummary` |

All four redirect URIs are needed because the login flow validates `redirect_uri` by **exact**
match, and the extension binds whichever of those four loopback ports is free. They deliberately
differ from `studylife-cli`'s 8765–8768 so both can be logged in at the same time.

Grant only what you want: the extension degrades rather than breaks. Without `TimerState.Save` the
timer commands report a permission error and everything else keeps working; without
`Sessions.Create` the coding-time suggestion has nowhere to go.

### 2. Connect

Run **StudyLife: Connect to an instance** from the command palette. You are asked for your
instance URL, then sent to your browser to approve the connection. The approval comes back through
a one-time assertion which is redeemed for this installation's own API key.

The key is stored in the editor's **secret storage**, never in settings — settings sync would
otherwise carry it to every machine you sign in on.

## Commands

| Command | What it does |
| --- | --- |
| `StudyLife: Connect to an instance` | Browser login, stores this installation's key |
| `StudyLife: Disconnect` | Forgets the local key (revoke it on the server separately) |
| `StudyLife: Start focus timer` | Starts the shared timer, keeping the current course |
| `StudyLife: Start focus timer for a course` | Asks which course first |
| `StudyLife: Choose the focus mode` | Picks the preset for the next session |
| `StudyLife: Pause focus timer` | Pauses it |
| `StudyLife: Stop focus timer` | Stops it |
| `StudyLife: Log tracked coding time as a session` | Offers the stretch tracked so far |
| `StudyLife: Set the course for this workspace` | Changes the remembered course |
| `StudyLife: Refresh now` | Polls immediately instead of waiting |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `studylife.instanceUrl` | — | Base URL of your instance |
| `studylife.pollSeconds` | `30` | Status bar refresh interval |
| `studylife.trackCodingTime` | `true` | Watch editing activity and offer to log it |
| `studylife.idleMinutes` | `5` | Editing pause that ends a stretch |
| `studylife.minimumSuggestionMinutes` | `20` | Shorter stretches are dropped instead of offered |

## Privacy

The extension talks to your instance and nowhere else. No telemetry, no third-party services.
What leaves your machine is: the poll for timer state and metrics, timer transitions you trigger,
and sessions you explicitly confirm. File contents and file names are never sent — the workspace
*name* is used as the session topic, and only for a session you approved.

## Development

```bash
npm install
npm run typecheck
npm run format:check   # or `npm run format` to fix
npm test
npm run build      # bundle into dist/
npm run package    # produce the .vsix
```

`vscode` stays external in the bundle: it is provided by the editor at runtime, and bundling it
produces an extension that fails to activate.

The modules without editor dependencies (`oauth.ts`, `activity.ts`, `timer.ts`, `panelModel.ts`,
`html.ts`, the render functions in `statusBar.ts`) hold the rules that are easy to get subtly
wrong, and those are what the tests cover — PKCE shape, constant-time state comparison, callback
parsing, the stretch/idle arithmetic, the timer transitions, the panel's HTML-escaping, and
everything the panel displays. `panel.ts` keeps the vscode-facing half separate precisely so
`panelModel.ts` can be tested without an editor; `auth.ts` and its loopback server are tested
against a small `vscode` stand-in aliased in `vitest.config.mts` instead, since only the socket
and secret-storage plumbing needs the real editor.

`timer.ts` and `runLog.ts` are worth reading before changing anything about the timer. The wire
shape has neither a "paused" flag nor a course, and the server accepts unknown JSON properties
silently — so a wrong field name produces a green build and a control that does nothing. Both
mistakes were made here before the shape was checked against `TimerStateEntity`.

## Licence

AGPL-3.0-or-later — see [LICENSE](LICENSE).
