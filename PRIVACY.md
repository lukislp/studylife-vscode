# Privacy

This document describes what the StudyAtrium extension for VS Code stores and where data
goes. The extension runs only on your machine and talks only to the StudyAtrium instance you
configure in `studylife.instanceUrl`. The operator of that instance is the contact for privacy
questions and requests.

## What the extension stores on your machine

- **Your API key** in VS Code's secret storage (`context.secrets`), not in settings, so
  settings sync does not carry it to other machines.
- **Extension state** in VS Code's `globalState`: the run this window started (course id and
  name, start time, planned session id), the remaining time of a paused timer, your selected
  timer mode, and the course remembered for each workspace folder (keyed by the folder URI, so
  it contains your local folder path).
- **Settings** you change (`studylife.instanceUrl`, poll interval, coding-time tracking and its
  thresholds) in the normal VS Code settings.

The extension keeps no log file and has no telemetry. Coding activity is tracked in memory
only, as start and end timestamps of editing stretches (when `studylife.trackCodingTime` is on).
File contents and file names are never read or sent.

## What is sent, and to whom

Only to your StudyAtrium instance, authenticated with your API key:

- polls for timer state and the metrics summary, and course and session lists;
- timer transitions you trigger (start, pause, stop, mode);
- sessions that the extension books when you stop a run it started, or when you confirm a
  suggested coding-time block. A session carries the course, start and end time, timer mode
  and a topic (the course name for timer runs, the workspace name for coding time).

The login opens your instance in the browser and receives the result on a loopback listener
(`127.0.0.1`, ports 8775 to 8778). The one-time assertion is exchanged once for the API key.

No third-party services are contacted.

## Retention and deletion

- Run **Disconnect** to remove the API key from the secret storage. This is local only: it
  does not revoke the key on the server. Revoke the key in the StudyAtrium web app (settings
  for connected apps and API keys).
- Uninstalling the extension removes its stored state according to VS Code's own behaviour.
- Sessions already sent to StudyAtrium are held there under the instance's own retention
  rules and are deleted with your StudyAtrium account.

## Contact

Questions, access or deletion requests: contact the operator of the StudyAtrium instance you
use. Security issues: see [SECURITY.md](SECURITY.md).