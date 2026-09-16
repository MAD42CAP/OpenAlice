# Market Evidence Monitor

Status: core platform implemented and live on the Mac. Quality hardening and
sustained acceptance are active on `MAD42CAP/OpenAlice:feature/market-evidence-monitor`.
No integration, merge or release is authorized.

Related issues: none.

Owner guides: [[docs/market-data-architecture.md]],
[[docs/ui-interaction-and-motion.md]], [[docs/development-workflow.md]].

## Scope

Build a read-only evidence monitor for BTC, TSLA and MSTR inside the existing Market
web shell. Reuse BarService for attributed daily and hourly candles, compute
observable price/volume evidence without claiming to know a market actor's
intent, persist settings/observations/alerts under the OpenAlice data root, and
present the result as a responsive dashboard with deterministic demo data.

## Current delivery checkpoint (2026-09-16)

The original plan is a checklist, not a numbered phase schedule. Grouping that
checklist by deliverable gives the current position:

| Deliverable | Position |
|---|---|
| Read-only data, persistence, routes and dashboard | Implemented |
| Provider fallback, MSTR, scheduling, receipts, health and Mac lifecycle | Implemented; real Coinbase scan previously repaired and verified |
| Multi-timeframe evidence, Wyckoff candidates, brief and Codex narrative | Implemented; confidence/calibration and timing defects found in audit |
| Data-quality and interpretation hardening | Active increment: closed bars, strict event tests, freshness, units, truthful source diagnostics |
| Sustained acceptance and integration | Still pending: 24–72 hours after hardening; owner acceptance before any merge |

The September 16 audit found issues that passing example-based tests had not
covered. Functional completion does not imply calibrated prediction or final
acceptance. Fixed-horizon evaluation/replay, narrative-to-snapshot binding,
exchange holiday calendars, SEC access reliability and production operations
remain follow-up work in this active plan; this increment does not claim them
complete.

Autonomous UI decision for this increment: retain the responsive dashboard and
existing components. Add a visible closed-bar basis and scoring explanation,
keep live charts separately labelled, preserve date-only session identifiers,
and use explicit metric units. Text is visible without hover or color decoding;
no new interactive primitive, navigation or focus behavior is introduced.

## Decisions

- Multi-timeframe direction and Wyckoff interpretation are deterministic domain
  outputs, not prose invented by a model. The dashboard may later pass those
  structured facts through an optional narrator, but loss of an Agent runtime
  must never remove the monitor's daily brief.
- A Codex narrator must run through OpenAlice's native Workspace/Issue Agent
  path, never as a second in-process model loop inside the monitor service. It
  is opt-in because each scheduled narration consumes an Agent run; the
  deterministic brief remains the fallback and source of truth.
- The user-facing fork brand is `MAD42Lab`. Protocol names, package scopes,
  data paths and upstream attribution retain `OpenAlice` so future upstream
  upgrades do not become a repository-wide compatibility migration.
- Daily briefs are keyed by asset, strategy and the latest attributed daily-bar
  date. Repeated intraday scans may update live evidence but do not create a
  second nominal daily brief or a second model-cost boundary for that market
  date.
- The first Wyckoff module exposes the complete analysis vocabulary (range,
  phase candidate, event candidates, test state, supporting and opposing
  evidence, confirmation and invalidation) while remaining explicit that phase
  and event labels are hypotheses. It never claims to identify a coordinated
  market actor.
- Short, medium and long horizons remain separate. Their disagreement is a
  first-class `mixed` alignment state rather than being averaged into a false
  single-direction answer.

- A slow asset must not hold the scheduler's poll lock for other assets.
  Poll exclusion and per-asset scan exclusion have separate lifetimes.
- Every completed attempt records duration, strategy and compact source health,
  including semantic duplicates. Historical receipts without this metadata
  remain explicitly unknown; do not infer healthy sources from scan success.
- Health reports cover requested 24/72-hour windows with actual first/last
  samples and an explicit receipt cap. Success rates describe recorded
  attempts, not continuous uptime, missing scheduled runs or strategy profit.
- Sustained acceptance uses a separate read-only observer. It checkpoints every
  probe, does not mutate settings or dispatch scans, and only marks recovery
  after a successful probe observes the recovered state.
- Mac source acceptance has one launcher that checks the toolchain, defaults to
  Lite mode, adopts Guardian's selected UI port and opens the dashboard only
  after verifying the OpenAlice shell. It does not switch branches or take over
  an existing runtime.
- Fresh source installs link workspace packages before their distributable
  entry points exist. Real dev and demo launch therefore build the UI's
  connector protocol dependency before Vite resolves its `dist` export.
- The Mac launcher defaults to a detached Guardian-owned source stack. Status,
  browser open and graceful stop use Guardian's existing control/ownership
  contract; helpers refuse foreground or foreign runtime owners.
- Read recent journals backwards in bounded blocks rather than parsing whole
  archives on every 15-second poll. Keep append-only history intact.
- Autonomous UI choice: a compact Operations section within the existing
  dashboard, 24h/72h native buttons, an export button, source health table and
  recent scan rows. Reuse existing primitives and typography; tables scroll
  on narrow windows. No new route or navigation hierarchy is required.

- Delivery is limited to `MAD42CAP/OpenAlice`. The former upstream PR #1494
  is closed, unmerged; do not recreate it or use upstream deployments.
- Background scan ownership moves from browser timers into the WebPlugin
  lifecycle, sharing one monitor service with HTTP/IPC requests. This is a
  read-only domain poller, not a Workspace/agent dispatch engine.
- Autonomous UI choice: extend the existing settings disclosure and add one
  compact wrapping status strip. Native labeled controls remain keyboard
  accessible and use existing theme tokens; no modal or new navigation layer.
- Background monitoring is explicit opt-in, persists through restart, and
  respects enabled assets. Pause stops future dispatch, not an active read.
  Browser closure does not stop scans; backend exit or machine sleep does.
- Scheduled/manual overlap for one asset shares one in-flight scan. Cadence
  resumes from persisted completion receipts, never replays missed intervals,
  and retries failures no faster than the configured cadence.

- This is a Market product surface, not a second trading engine or account
  service. It never submits, stages, approves, or cancels orders.
- Strategy inputs and output types are isolated from HTTP and React so future
  algorithms can be added behind one registry.
- The first strategy is an evidence-chain interpretation of location,
  effort/result, confirmation, invalidation, and competing explanations.
- Daily and hourly bars remain separately attributed. Daily bars are never
  relabelled as intraday data when the hourly source fails.
- A semantic fingerprint excludes cache/transport mechanics so repeat scans do
  not create duplicate observations or alerts.
- The UI is one focused working view in the existing Market shell. On narrow
  windows, controls wrap and evidence tables scroll instead of creating a
  second navigation hierarchy.
- Browser notifications are opt-in and only available while the dashboard is
  open. Native/background delivery is a later product increment.
- Live acceptance is a separate, loopback-only smoke command. Its default mode
  is read-only; explicit `--scan` performs two monitor scans per selected asset
  and records a machine-readable receipt without touching trading routes.
- Live BTC acceptance showed raw derivatives decimals changing between
  consecutive requests. Fingerprints therefore quantize those fields at
  decision scale while snapshots retain the full observed values.
- The same live pass exposed a transient Deribit timeout. Context orchestration
  now retains the last valid values while recording the outage in source
  health, rather than replacing a useful dashboard state with empty fields.
- Strategy and context collection are now runtime registries rather than
  service conditionals. Multiple context modules may compose for one asset;
  histories, chart series and evaluation remain isolated by strategy ID.

## September 16 input replay increment

Autonomous design: retain the existing responsive history table and add a
keyboard-accessible Replay check button per row. Results appear inline with a
live status region and use the shared Button, typography and theme tokens.
Narrow tables scroll; no modal, new route or animation is introduced. Input
exports are explicit user actions. A domain hook owns requests and discards
late results when selection changes. Alternatives (a new history route or a
full chart viewer) add navigation and are deferred.

Persist a new compressed, immutable sidecar only for newly stored observations,
with closed bars, exact analysis time, threshold parameters, strategy version,
full public context/source attribution and recorded output. Old observations
are already in use: leave their bytes intact and explicitly report unavailable
inputs. This additive store introduces no migration or speculative historical
backfill. Duplicate scans reuse the persisted observation identity. Replay uses
only archived inputs and checks complete deterministic output and fingerprint;
it is reproducibility verification, not predictive validation.

Codex publication requires the input snapshot identity and hash. The existing
one-narration-per-day cost boundary remains; moving evidence labels that prose
historical rather than silently invoking another model run. Older unbound prose
is explicitly unverified. Existing user changes to the narrator's CLI prompt
are preserved. Required fields are documented in the Workspace tool schema and
returned by daily-input, so both native tool and CLI callers receive them.

The observer uses the latest completed receipt to establish current source
state. Historical provider aggregates remain historical. A provider switch can
close an old fallback episode, while missing checks cannot prove recovery.

## Checklist

- [x] Add typed analysis, source-health, fingerprint and evaluation modules.
- [x] Add file-backed settings, observation, receipt and alert storage.
- [x] Add read-only HTTP routes and mount them in WebPlugin.
- [x] Add Market navigation, route identity, API client and dashboard.
- [x] Add deterministic demo handlers and fixtures.
- [x] Add focused backend/UI tests and run owner typechecks.
- [x] Exercise the demo build and record live Mac acceptance as a residual gap.
- [x] Commit and push the held feature branch without merging.
- [x] Add and verify the Mac live-API acceptance command on the draft branch.
- [x] Add strategy/provider registries, API discovery and dashboard selection.
- [x] Isolate chart persistence, history and evaluation by strategy ID.
- [x] Re-run demo/live acceptance for the modularity increment.
- [x] Publish the modularity increment to the draft pull request.
- [x] Close the former upstream PR and restrict development to our own fork.
- [x] Add lifecycle-owned background scheduling and concurrent scan protection.
- [x] Add truthful status/settings UI and deterministic regression tests.
- [x] Verify browser-free scheduling and persisted pause/restart behavior.
- [x] Isolate slow asset scans and bound recent journal reads.
- [x] Add per-attempt telemetry and bounded operational reports.
- [x] Connect health reports, export and deterministic demo/UI coverage.
- [x] Verify the health increment against isolated runtime data.
- [x] Add a checkpointed 24/72-hour observer for Mac/runtime acceptance.
- [x] Add a Mac source launcher for environment checks, demo and real dashboard.
- [x] Prepare UI workspace package exports automatically on a fresh clone.
- [x] Add controllable Mac background start, status, open and stop lifecycle.
- [x] Add deterministic short, medium and long trend assessments.
- [x] Add candidate-based Wyckoff range, phase, event and test-state analysis.
- [x] Add one daily brief identity per asset/strategy/attributed daily date.
- [x] Present localized trend, Wyckoff and daily-brief surfaces in the dashboard.
- [x] Verify the new analysis with backend, UI, typecheck and demo-build gates.
- [x] Rebrand the web shell's primary visible identity as MAD42Lab while
  preserving OpenAlice compatibility identifiers and attribution.
- [x] Recheck the hardened dashboard on the Mac and the deterministic demo.
- [x] Verify hardened BTC/TSLA/MSTR scans, including consecutive BTC attribution and fingerprinting.
- [ ] Observe the hardened Mac runtime for 24–72 hours; receipt history alone is not continuous uptime acceptance.
- [x] Add immutable historical analysis inputs and deterministic replay for new observations.
- [ ] Complete fixed-horizon evaluation before claiming predictive validation.
- [x] Bind generated narration to its exact input snapshot/version and label stale or unverified prose.
- [x] Correct observer current-state incidents without erasing historical failures.
- [ ] Resolve remaining source/operational acceptance findings, including SEC availability.

## September 16 Mac hardening acceptance

- Closed daily/hourly analysis, completed-week comparison, elapsed-hour
  continuity, stricter Wyckoff retests and rule-score wording are implemented.
- Stale preferred bars trigger fallback; both-source diagnostics are preserved.
  Deribit RPC errors/empty results are rejected, and retained context is scoped
  to the failed source with a bounded age and the original source timestamp.
- Percentage/OI units and date-only rendering are corrected. Evaluation is
  honestly labelled adjacent-observation agreement; flat/same-day samples and
  version transitions are excluded. Refresh follows latest observation identity.
- Startup credential output is suppressed when stdout is redirected, including
  the Mac background log. No existing credentials were inspected or rotated.
- Nineteen focused files pass 188 tests. Root and UI typechecks pass; the demo
  production build passes. Live and demo browser routes were verified.
- The complete platform suite passes 7,167 tests, with four skipped and two
  known pre-existing failures in `src/workspaces/adapters/ai-config.spec.ts`.
  Those assertions predate the owner's uncommitted Codex environment changes;
  the four pre-existing modified files were preserved byte-for-byte. Final
  analysis/date additions were rechecked with the focused suite and typechecks.
- Real BTC scanning returns Coinbase daily/hourly data, closed daily identity
  `2026-09-15`, markdown candidate, pending test, score 60/100. Two consecutive
  final scans share one fingerprint; the second is correctly a duplicate.
- TSLA and MSTR both scan successfully using Alpaca. SEC EDGAR remains HTTP 403
  and is shown unavailable; that residual is not claimed fixed.
- Delivery uses the connected GitHub plugin to publish the hardening increment
  on `MAD42CAP/OpenAlice:feature/market-evidence-monitor`. Terminal Git
  authentication is separate and is not a blocker for this connected workflow.
  No upstream or default branch is modified.
- A new 24-hour read-only Mac observer is started after the final restart.
  Its result remains incomplete until the duration and cadence gates finish.

## Replay increment acceptance on the Mac

- Fifteen focused files pass 116 tests, including immutable file publication,
  restart replay, corruption detection, unsupported strategy versions, changed
  output, duplicate identities, stale/legacy narration and observer recovery.
- Root and UI typechecks pass. The demo production build passes, and real and
  demo browser routes pass; the real replay was checked at 390px width.
- The complete suite passes 7,181 tests, with four skipped and the same two
  pre-existing Codex command assertions failing in
  `src/workspaces/adapters/ai-config.spec.ts`. No new failure is introduced.
  Final small observer/layout changes passed the focused suite and typechecks.
- Real BTC, TSLA and MSTR scans save archives and replay with zero differences.
  BTC uses Coinbase (399 completed daily and 179 completed hourly bars at this
  observation); equities use Alpaca (400 daily and 180 hourly bars). BTC context
  is healthy; SEC EDGAR remains unavailable for both equities.
- The corrected live observer has two actual SEC incidents, removing four
  historical Yahoo fallback false positives. Earlier checkpoints are preserved;
  a fresh 24-hour report uses the `replay-final` suffix after final verification.
  Sustained acceptance is still incomplete, not converted into a passing claim.
- The four pre-existing owner-modified files remain byte-for-byte unchanged and
  excluded from this increment. No live Codex narration was dispatched merely
  for testing; publication identity and authorization are verified in tests.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- Focused market-monitor backend and UI specs
- `pnpm test:changed` when the origin exposes a compatible `dev` base;
  otherwise explicit owner/path selection against `upstream/dev`
- `pnpm -F open-alice-ui build:demo`
- `pnpm market-monitor:acceptance -- --help`
- `pnpm vitest run scripts/market-monitor-live-smoke.spec.ts`
- Real `/market/evidence` demo route; Mac live-data acceptance remains external

Verified in the managed Linux workspace on 2026-09-12:

- Root and UI TypeScript checks passed.
- Seven focused files passed 28 tests, including registry validation,
  multi-provider failure isolation and cross-strategy history isolation.
- The deterministic demo production build passed and reported
  `/market/evidence` ready.
- The broader affected-test command reaches unrelated PTY, socket, installer,
  and temporary-Git suites that require host capabilities unavailable in this
  workspace. No Market Monitor test failed; native Mac acceptance remains the
  final environment-specific check.
- The live-acceptance helper and the original monitor closure pass five files
  and 18 tests; its help/argument contract also passes under pnpm 11.
- A full isolated Linux runtime passed both read-only and live-scan acceptance.
  BTC exercised healthy, timeout-with-retained-context and recovery states;
  TSLA exercised duplicate suppression and a meaningful new-news transition.
  Native macOS visual and long-window scheduling acceptance remains external.
- The modular runtime pass discovered `evidence-chain-v1`,
  `deribit-btc-v1` and `openalice-tsla-v1`, then completed BTC and TSLA scans.
  Restricted workspace access left Deribit visibly unavailable without
  interrupting BTC price evidence; TSLA fundamentals remained healthy.
- On 2026-09-14, the multi-timeframe/Wyckoff/daily-brief increment passed root
  and UI TypeScript, 19 focused domain tests, 11 dashboard tests, all 325 UI
  owner files (1,907 tests), and the demo production build. The Alice owner
  suite passed 160/161 files; its two config-bootstrap lock assertions failed
  only under the parallel suite and the same file then passed 4/4 in isolation.
  Cloud Browser again returned `ERR_BLOCKED_BY_CLIENT` for localhost, leaving
  the actual Mac window as the visual acceptance environment.

## Completion

Background monitoring verified in the managed Linux workspace on 2026-09-13:

- Root and UI TypeScript checks passed; nine focused files passed 52 tests.
- Demo and production UI builds passed (existing large-bundle warning remains).
- The real isolated runtime passed `--background` for BTC and TSLA: both
  receipts were `scheduled`/`stored` without any manual scan request or page.
  Original paused settings and 15-minute cadence were confirmed restored.
- A subsequent `--scan` pass succeeded for both assets. Price sources were
  healthy, BTC Deribit remained unavailable, and TSLA calendar/news remained
  degraded; these were visible source states, not synthetic replacements.
- File-backed tests covered cadence after restart, duplicate suppression,
  pause, asset selection and concurrent manual/scheduled callers. Probe tests
  covered restoration after success, failure or timeout and preservation of
  another operator's settings edits.
- The complete `pnpm test` attempt encountered failures in untouched CLI,
  Guardian, socket and temporary-Git suites and was interrupted; the whole
  repository suite is not accepted. The market-monitor closure passed.
- Cloud Browser refused `http://127.0.0.1:4173/market/evidence` with
  `ERR_BLOCKED_BY_CLIENT`; no workaround or external deployment was attempted.
  Browser visual/mobile and native Mac 24–72 hour acceptance remain open.

Operational health increment verified in the managed Linux workspace on
2026-09-13:

- Root and UI TypeScript checks passed. Thirteen focused files passed 70 tests,
  covering stalled-asset isolation, failed-receipt visibility/recovery, journal
  tail reads, missing telemetry, capped windows, source recoveries, selection
  races, refresh errors and exact exported JSON contents.
- The slow-asset regression failed before the scheduler fix: a pending BTC
  request held TSLA to one scan. After the fix TSLA completed three scans over
  two simulated minutes while BTC remained pending.
- A 20,000-record journal test fetched the latest three matching records by
  reading one 64 KiB block, less than one tenth of the archive. Multi-block
  UTF-8 and damaged-tail tests also passed. This is bounded-read evidence,
  not a production throughput benchmark.
- Demo and production UI builds passed; the pre-existing large-bundle warning
  remains. Native/browser visual acceptance and the whole-repository suite
  retain the environment gaps recorded above.
- The actual isolated runtime passed both `--background` and `--scan` and
  restored paused settings at a 15-minute cadence. Each asset's health report
  contained one scheduled and two manual attempts with duration/source checks.
- BTC recorded three changed observations. TSLA recorded two changed and one
  unchanged observation. Both price timeframes were healthy; Deribit remained
  unavailable and TSLA calendar/news degraded, counted on all three attempts.
- The real 72-hour API selection returned the same three short-run samples per
  asset with actual sample times. No 24/72-hour uptime claim is made. The test
  backend and its isolated temporary state were removed after acceptance.

Long-run observer increment verified in the managed Linux workspace on
2026-09-13:

- The observer parser, cadence assessment, incident recovery and atomic
  checkpoint tests passed with the focused monitor closure.
- A real isolated one-minute observation completed five of five probes with
  at most 50 ms local API latency and captured one scheduled receipt for BTC
  and one for TSLA without dispatching a manual scan.
- Its final result was `attention`, as intended: Deribit remained unavailable
  and TSLA calendar/news remained degraded. The short run labelled cadence
  evidence `insufficient-duration`; it did not claim 24/72-hour acceptance.
- The isolated backend and temporary state were removed after the observation.

Mac launcher increment verified in the managed Linux workspace on 2026-09-13:

- The focused monitor closure passed 15 files and 79 tests. Root TypeScript,
  launcher help, Bash syntax and diff checks passed.
- Tests cover launch option safety, Node/pnpm version gates, branch warnings,
  Guardian port parsing and refusal to treat an unrelated local page as the
  OpenAlice dashboard.
- The real environment check correctly reported Node 24.19, pnpm 11.19,
  installed dependencies and the feature branch, then refused to launch on
  Linux because this entry point is Mac-specific.
- The actual Finder double-click, default-browser open and Mac foreground
  process shutdown were the previous native Mac acceptance gate.
- The first real fresh-clone Mac attempt exposed a missing
  `@traderalice/connector-protocol` `dist` entry after `pnpm install`. Repeating
  that state locally now runs the automatic dependency build first; the full
  demo UI resolved 3,925 modules and completed successfully.
- The focused monitor closure still passed 15 files and 79 tests after the
  fresh-clone launch repair.
- Managed Linux could not run Guardian's `tsx` IPC pipe (`EPERM`) for the full
  source-dev stack. This is the previously recorded host restriction; the
  missing-package build and complete Vite import graph both passed.

Mac background lifecycle increment verified in the managed Linux workspace on
2026-09-13:

- The focused Guardian/monitor closure passed 17 files and 87 tests. Root and
  UI TypeScript, launcher help, Bash syntax, absent-runtime status/stop and diff
  checks passed.
- The complete hermetic suite reached 800 passing files and 6,938 passing
  tests. Ten files remained blocked by the managed host: Unix socket `EPERM`,
  unavailable node-pty native payload, missing dugite Git payload and installer
  process-identity reads. The new launcher and Guardian option specs passed.
- Native macOS acceptance still needs to prove that Finder start returns after
  readiness, the detached process survives closing Terminal, Open reuses the
  selected port, and Stop releases the Guardian owner and child tree.

The branch is complete when BTC and TSLA can be scanned read-only, duplicate
snapshots are suppressed, source failure is visible without erasing the last
good view, the 1D/1H dashboard and histories work in demo and production paths,
all proportional tests pass, and the verified branch is pushed for Mac review.
