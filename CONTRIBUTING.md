# Contributing to studylife-vscode

Thanks for taking the time. This is a single-maintainer project, so the process is deliberately
small - but it is the same for every change, including the maintainer's own.

## How changes get in

1. Open an issue first for anything bigger than a typo or an obvious bug fix, so the direction can
   be agreed before you spend time on it. Use the templates under `.github/ISSUE_TEMPLATE/`.
2. Fork the repository (or branch, if you have write access) and make your change on a branch.
3. Open a pull request against `main`. The pull-request template asks for what changed and why.
4. `main` is protected: a PR merges only once its required checks are green
   ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)'s `lint` and `build` jobs, plus
   `dependency-review.yml`) and the branch is up to date with `main`. Nobody pushes to `main`
   directly, not even the maintainer.

## What a pull request needs

- **Conventional Commits.** The version and `CHANGELOG.md` are generated from the commit messages
  by semantic-release (`fix:` = patch release, `feat:` = minor release; `build:`/`ci:`/`docs:`/
  `test:`/`chore:` produce no release). If the PR is squash-merged, the squashed commit message -
  usually the PR title - is what gets analyzed, so give the PR a Conventional Commit title too.
- **Tests for new functionality.** New behaviour and bug fixes come with tests under `tests/`
  (`npm test`, via Vitest). Most of the logic lives in modules with no `vscode` import
  (`oauth.ts`, `activity.ts`, `timer.ts`, `runLog.ts`, `panelModel.ts`, `html.ts`, the pure parts
  of `api.ts`) specifically so it can be unit-tested without the editor - put new logic there
  rather than in `extension.ts` when you can. `auth.ts` is the exception: it does import `vscode`,
  and its tests load a small stand-in for that module instead (`tests/mocks/vscode.ts`, aliased in
  `vitest.config.mts`) rather than the real editor.
- **Type checking.** `npm run typecheck` (`tsc --noEmit`) runs as a required check. The compiler
  options are strict on purpose (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `exactOptionalPropertyTypes`) - work with that rather than loosening it for one change.
- **Formatting.** `npm run format:check` (Prettier) runs as a required check; run
  `npm run format` before pushing. There is deliberately no ESLint step yet - typescript-eslint
  does not support the TypeScript major this repo builds with
  ([tracking issue](https://github.com/typescript-eslint/typescript-eslint/issues/10940)); it will
  be added back once that lands.
- **No behind-the-back network calls or writes.** Turning tracked coding time into a session is
  always a confirmation the user answers (`vscode.window.showInformationMessage(...)` with
  "Log it"/"Discard") - see `activity.ts` and the note at the top of `extension.ts`'s
  `offerStretch`. A misattributed session would skew the grade/ECTS correlations StudyLife
  computes from session history, so this is not just a style preference.
- **Wire shapes.** The extension talks to a handful of StudyLife REST endpoints (`api.ts`). The
  server accepts unknown JSON properties silently, so a wrong field name produces a green build
  and a control that quietly does nothing - check a field against the server's actual DTO/entity
  before relying on it, don't guess from the docs alone.

## Running things locally

```bash
npm install
npm run typecheck
npm run format:check   # or `npm run format` to fix
npm test
npm run build           # bundle into dist/
npm run package         # produce the .vsix
```

See the README's [Development](README.md#development) section for more on how the modules are
split and why.

## Security issues

Please do not open a public issue for a vulnerability - use the private reporting path described
in [SECURITY.md](SECURITY.md).
