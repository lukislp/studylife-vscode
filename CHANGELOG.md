# [1.5.0](https://github.com/lukislp/studylife-vscode/compare/v1.4.5...v1.5.0) (2026-09-18)


### Features

* show the full course name as a tooltip on truncated goal/session rows ([#20](https://github.com/lukislp/studylife-vscode/issues/20)) ([5b32120](https://github.com/lukislp/studylife-vscode/commit/5b32120ab009d232af7ca0bfa139f38e4d80b55d))

## [1.4.5](https://github.com/lukislp/studylife-vscode/compare/v1.4.4...v1.4.5) (2026-09-18)


### Bug Fixes

* stop the paused timer from being repainted as running mid-race ([#19](https://github.com/lukislp/studylife-vscode/issues/19)) ([c5fa926](https://github.com/lukislp/studylife-vscode/commit/c5fa9266173aeda262815b03a46ef90ee1ee3e16))

## [1.4.4](https://github.com/lukislp/studylife-vscode/compare/v1.4.3...v1.4.4) (2026-09-18)


### Bug Fixes

* use the official StudyLife logo for the Activity Bar icon too ([#18](https://github.com/lukislp/studylife-vscode/issues/18)) ([4d595f7](https://github.com/lukislp/studylife-vscode/commit/4d595f7a5ffe74810c526b1e66760f4735290fe8))

## [1.4.3](https://github.com/lukislp/studylife-vscode/compare/v1.4.2...v1.4.3) (2026-09-18)


### Bug Fixes

* distinguish a paused focus timer, and use the official logo ([#17](https://github.com/lukislp/studylife-vscode/issues/17)) ([507f324](https://github.com/lukislp/studylife-vscode/commit/507f324ba0b667d28e1a7bbe955680a28dbf0d9d))

## [1.4.2](https://github.com/lukislp/studylife-vscode/compare/v1.4.1...v1.4.2) (2026-09-17)


### Bug Fixes

* harden API client, close test gaps, and add lint/format tooling ([#16](https://github.com/lukislp/studylife-vscode/issues/16)) ([dfed908](https://github.com/lukislp/studylife-vscode/commit/dfed908911493d2ffd441331167046abbbb84961)), closes [typescript-eslint/typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)

## [1.4.1](https://github.com/lukislp/studylife-vscode/compare/v1.4.0...v1.4.1) (2026-09-17)


### Bug Fixes

* **deps:** bump @types/node in the dev group across 1 directory ([#3](https://github.com/lukislp/studylife-vscode/issues/3)) ([7405de1](https://github.com/lukislp/studylife-vscode/commit/7405de191191fbeea77483df4588eb85383fbde6))

# [1.4.0](https://github.com/lukislp/studylife-vscode/compare/v1.3.2...v1.4.0) (2026-09-17)


### Features

* let the focus mode be chosen ([#13](https://github.com/lukislp/studylife-vscode/issues/13)) ([961a1a9](https://github.com/lukislp/studylife-vscode/commit/961a1a9281cdbb1893dbf953e21926c36356f72c))

## [1.3.2](https://github.com/lukislp/studylife-vscode/compare/v1.3.1...v1.3.2) (2026-09-17)


### Bug Fixes

* stop discarding short timer runs in silence ([#12](https://github.com/lukislp/studylife-vscode/issues/12)) ([4451759](https://github.com/lukislp/studylife-vscode/commit/4451759f3fd6b63c4611ad2cafc5693fad178f1e))

## [1.3.1](https://github.com/lukislp/studylife-vscode/compare/v1.3.0...v1.3.1) (2026-09-16)


### Bug Fixes

* keep the remainder on pause, show real hours today, stop rows overflowing ([#11](https://github.com/lukislp/studylife-vscode/issues/11)) ([4887ed9](https://github.com/lukislp/studylife-vscode/commit/4887ed9918544c1fb543fc6efbb2e3822ea3f41e))

# [1.3.0](https://github.com/lukislp/studylife-vscode/compare/v1.2.0...v1.3.0) (2026-09-16)


### Features

* record a study session when a timer run had none planned ([#10](https://github.com/lukislp/studylife-vscode/issues/10)) ([4e53cb7](https://github.com/lukislp/studylife-vscode/commit/4e53cb7acc5c6817366239b9ea67c9d8c61123d9))

# [1.2.0](https://github.com/lukislp/studylife-vscode/compare/v1.1.0...v1.2.0) (2026-09-16)


### Features

* redesign the panel and fix the timer transitions ([#9](https://github.com/lukislp/studylife-vscode/issues/9)) ([61f761f](https://github.com/lukislp/studylife-vscode/commit/61f761f5cdcdb887b7f4cf43e09093cf476a896d))

# [1.1.0](https://github.com/lukislp/studylife-vscode/compare/v1.0.0...v1.1.0) (2026-09-16)


### Features

* add an activity bar view with timer controls ([#8](https://github.com/lukislp/studylife-vscode/issues/8)) ([bbef575](https://github.com/lukislp/studylife-vscode/commit/bbef57507d48403c13aabcd54f54e3206a4d9539))

# 1.0.0 (2026-09-16)


### Bug Fixes

* **ci:** bump the semantic-release action past the first-release bug ([#5](https://github.com/lukislp/studylife-vscode/issues/5)) ([29dca97](https://github.com/lukislp/studylife-vscode/commit/29dca97ed4debb0d3fa267c581a8eae823dd508a))
* **ci:** let semantic-release push over ssh, not https ([#7](https://github.com/lukislp/studylife-vscode/issues/7)) ([024e9aa](https://github.com/lukislp/studylife-vscode/commit/024e9aa5e3e836389bcc10503c2a0fc86fccda27))


### Features

* control the StudyLife focus timer and log coding time from VS Code ([76a3f39](https://github.com/lukislp/studylife-vscode/commit/76a3f3927cc054128d4d39005431c19cbc994605))
* initial commit ([43cdafd](https://github.com/lukislp/studylife-vscode/commit/43cdafdbbd7a0bbce7e5f2e8b53409d668d13808))

# Changelog

All notable changes are generated by semantic-release from the commit history.
