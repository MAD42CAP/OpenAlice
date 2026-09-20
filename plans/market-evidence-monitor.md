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
- [x] Resolve SEC declaration 403 and verify both monitored equities against the official feed.
- [ ] Complete the remaining sustained operational acceptance.

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

## SEC automated-access follow-up

- Reproduced both companies' HTTP 403 with the application client and reproduced
  TSLA with system curl using the same declared project identity. SEC's body
  identifies an undeclared automated tool, not a rate-threshold page. The
  existing User-Agent includes only the GitHub project URL and no contact.
- Implemented a private operator-contact configuration, explicit declaration,
  shared pacing, 403/Retry-After cooldowns, sanitized diagnostics and stricter
  submissions validation. Existing snapshot/settings shapes are unchanged;
  this new optional local configuration needs no historical migration.
- Domain regression tests and root typecheck validate the implementation.
- The owner supplied and authorized a contact email. It is stored only in the
  local contact file with mode 0600. No address is guessed from Git metadata
  or unrelated local account data, and the actual contact never enters Git.
- Direct read-only SEC requests now succeed for TSLA and MSTR and each returns
  six material filings. After restarting the platform, real TSLA and MSTR
  scans both report SEC healthy with six filings and verified input replay.
  BTC remains healthy with Coinbase daily/hourly bars and verified replay.
- Thirteen focused files pass 102 tests; root TypeScript and diff checks pass.
  The real dashboard displays both companies' official filing links and the
  healthy SEC status. Legacy AI prose and historical failed receipts remain
  explicitly historical/unverified and are not silently rewritten.
- The previous observation checkpoint is preserved. A fresh 24-hour read-only
  observer uses the `sec` report suffix after this restart; sustained acceptance
  still requires its full observation window. Owner modifications are preserved.

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


## September 17 operational hardening

The completed September 16 18:10–September 17 18:10 Vancouver observation
recorded 1,441/1,441 successful probes and 282 successful automatic scans (94
per asset, including daily interpretation refreshes). Six source incidents
clustered in two scan rounds and all recovered. One Coinbase daily timeout
fell back successfully to Yahoo; hourly Coinbase and equity Alpaca continued.
SEC was healthy in all 188 checks. The verdict remains `attention`, not an
all-green or predictive acceptance claim.

This increment addresses the observed failures and audit gaps:

- [x] Preserve successful context independently of semantic de-duplication and
  restart; allow bounded BTC display grace with original time/expiry and an
  explicit stale-data notice. Never renew failed data or replace successful
  empty results.
- [x] Classify equity subrequest failures without leaking request material;
  add one bounded transient retry and retain ownership of stuck upstream reads.
  Keep SEC cooldown and declaration rules unchanged.
- [x] Detect overdue and stalled scans and gaps hidden between probes; expose
  active start time and distinguish daily interpretation from periodic scans.
- [x] Complete cross-owner regression review, live scans/replay and real/demo UI acceptance; retain the two known Codex adapter baseline failures.
- [x] Begin a fresh 72-hour observation of this increment after verification;
  finishing this code increment does not claim that future observation passed.

Autonomous UI decision: retain the current dashboard and responsive grids.
Place plain-language old-data notices beside the context values, including
field names, original time and expiry. Use existing warning text and status
semantics; no new controls, navigation, modal or focus behavior. Show periodic,
manual and interpretation scan counts separately in the existing operations
panel. A per-asset runtime error promotes its status strip to attention.

The four pre-existing user edits in CLI commands, narrator prompting and the
Codex adapter are outside this increment and must remain uncommitted.

Verification: 20 focused files / 220 tests pass, including monitor domain,
Coinbase/BarService, HTTP configuration/monitor routes and both market pages.
Root and UI typechecks pass. Full hermetic suite with permission to bind local
test servers: 822 files pass, one has the two previously known Codex command
expectation failures; 7,212 tests pass, two fail, four skip. The failing adapter
expectations differ only in the two environment arguments introduced by the
pre-existing user edit; none of those files were changed by this increment.
The first sandboxed full run could not bind even a loopback ephemeral port
(EPERM) and was interrupted; it is not used as regression evidence.

The restarted Mac runtime scanned BTC with Coinbase (400 daily / 180 hourly),
TSLA/MSTR with Alpaca, and all context sources including Deribit/SEC were healthy.
All three returned observation IDs replay as verified, including legacy equity
observations reused by duplicate scans. The new context files exist separately
for each asset and record the actual successful scan time. Real and demo routes
render the three trigger counts; demo narrow layout was checked at 390px, with
no browser console errors on the real route. Retained-data warnings and stalled
runtime status are covered in component tests without inducing a real outage.

A new detached, read-only 72-hour observer began at 2026-09-18T06:05:58Z
(September 17 23:05 Vancouver), planned to finish September 20 23:05 Vancouver.
Its checkpoint is `market-monitor-acceptance-2026-09-17-ops.json` in the local
state directory. Initial probes are healthy; the observation remains incomplete.
No notifications were enabled and no predictive-validation claim is made.

## September 18 — historical outcome review (implemented)

User request: compare earlier daily reasoning, trend and Wyckoff judgments with
subsequent market movement and feed the findings into future analysis.

Autonomous design choice: integrate a Historical review surface before the
existing input-replay history. A separate route would add navigation and split
original evidence from its outcome; the integrated surface keeps one asset
context. Date/case, report-window and horizon selectors use labelled native
controls and shared Buttons. Two columns stack on phones; the outcome table
scrolls within its own container. A compact accessible price path complements
exact daily prices. No new animation or visual vocabulary is introduced.

Protocol chosen before inspecting outcome scores: forward-sessions-v1, first
recorded observation per publication session date and strategy version; AI
narrations remain a separate cohort with their actual publication timestamp.
Entry is the next observed daily session open after publication date. Horizons
are 1 / 7 / 30 daily bars for BTC and 1 / 5 / 20 observed stock sessions. Pair
short / medium / long with those horizons as descriptive consistency checks,
not retroactively claimed original price targets. Flat band is fixed at 0.25%;
flat directional cases stay in the denominator without counting as successes.
Keep version groups, overlapping-sample caveats, pending/excluded counts, and
an always-bullish baseline on the identical scored cases. Preserve original
Wyckoff conditions and record range-close facts without calling the entire
phase confirmed. No free-form narrative receives an invented machine verdict.

- [x] Implement bounded read-only outcome projection and archive binding.
- [x] Feed compact prior outcomes and case identities into native daily inputs.
- [x] Complete historical comparison UI, realistic demo and regression tests.
- [x] Verify real local API/UI and document limits; deliver on the owned branch.
- [ ] Accumulate untouched future observations before adopting judgment-rule
      changes; a few days of retrospective history are not a validation sample.

September 18 verification: 7 focused files / 83 tests passed; backend and UI
type checks passed. Complete suite: 824 files passed, one existing failure
file (`src/workspaces/adapters/ai-config.spec.ts`); 7,230 tests passed, two
pre-existing adapter assertions failed, four skipped. The four pre-existing
user-modified files remain byte-for-byte unchanged and excluded from delivery.
The final feedback payload and duplicate-date hardening received a further
focused run. No trading or account operation was used.

Real BTC/TSLA/MSTR review endpoints returned archived originals, bounded
outcomes and explicit missing/pending states. At verification BTC and MSTR each
had only one completed directional case; TSLA's completed case was
non-directional. No weekly case was mature. A live BTC scan succeeded using
Coinbase daily/hourly data and Deribit context. Real and demo pages were
exercised, including changing records/horizons, raw prose, pending windows,
390px layout and a valid downloaded JSON report. Browser console errors: none.
Source hot reload made a manual platform restart unnecessary. The existing
72-hour operational observer continues with its original report and start time;
it is still incomplete and is not relabelled as 72 hours of this new version.

## Research dashboard increment — 2026-09-18

User approved immediate implementation after comparing the BTC and Strategy
reference dashboards. Hashrate, mining difficulty and mining cost models are
explicitly excluded. Work remains on the owner's feature branch only.

Autonomous design choice: extend the existing evidence page with an inline
research section rather than a competing route. Native 30/90/365-day controls,
two-column panels collapsing to one column, unit-separated charts, keyboard
accessible event selection and existing theme/shared primitives. Source dates,
acquisition times and formula versions remain expandable beside each metric.
STRC is a distinct issuer-research subgroup, not an ordinary-stock Wyckoff asset.

- [x] Preserve original judgments while linking chart events to input replay.
- [x] Persist fresh derivatives from every scan, including semantic duplicates;
      gaps and retained/stale values must not become invented observations.
- [x] Add attributed Alternative.me and Coin Metrics Community MVRV history,
      complete 200-week average and
      source-specific anchored VWAP using existing read-only bar providers.
- [x] Add original-source Strategy/STRC metrics, quotes/dividend calendar and
      comparable price histories; date/definition gaps remain visible.
- [x] Expose a bounded research API and keep browser-independent collection
      attached to the existing opt-in scan scheduler.
- [x] Verify relevant hermetic tests, root/UI types, real local and demo browser
      routes, live read-only APIs and calendar-date rendering across timezones.

Acceptance: 141 focused tests pass; root and UI type checks pass. The full
hermetic suite has 7,299 passing tests, four skipped and two failures in the
existing Codex AI-config command expectations. Those failures correspond to
pre-existing user changes outside this increment; the four initially modified
user files remain untouched and excluded from delivery. Desktop live views,
390px demo layout, asset/window switching and original-input replay were checked.
Real BTC and MSTR scans succeeded with Coinbase and Alpaca respectively. Source
hot reload served the new dashboard without stopping the running monitor.

Research collection is independent of scan completion, cadence and shutdown.
Concurrent chart windows serialize per-asset journal writes, and bounded history
processing uses timestamp sets. UTC calendar series preserve their dates while
intraday observations retain local-time display.

Source limitations remain explicit: issuer disclosure dates and USD reserve are
unknown where the official payload does not supply them; collection dates are
not retroactive disclosure dates. Financing-flow histories and dividend-adjusted
total returns are deferred until reliable underlying records are available.
Coin Metrics Community attribution and noncommercial terms are shown alongside
MVRV. This increment excludes hashrate, difficulty and mining-cost models.

New research metrics are descriptive context. They do not silently alter the
existing scoring strategy or retroactively become inputs to old judgments.
Unlicensed/paid on-chain data is not fabricated; providers requiring a new
subscription remain outside this increment. Rule calibration needs later
forward observations and explicit versioned evaluation.

## Research visibility and latest prices — 2026-09-18

Reproduced in the owner's Chrome tab: the research section loaded but its
request failed. Direct backend and Vite-proxied requests returned HTTP 200;
Chrome navigation to the same research endpoint returned ERR_BLOCKED_BY_CLIENT.
The exact blocking extension is not established. Browser protection settings
remain unchanged; use a descriptive first-party `/research` read endpoint.

Autonomous UI choice: retain the page layout and add a prominent latest-trade
strip above the daily brief, with a refresh button, source and trade time.
Visible pages poll every 30 seconds and refresh on return; closed daily analysis
stays separate. Controls wrap on mobile, reuse Button, and expose status as text.
Research refresh retains the previous chart on transient failure and retries
with a bounded cadence. A top-page research link makes the section discoverable.

- [x] Repair research loading and verify it in the owner's Chrome page.
- [x] Add independent read-only BTC/TSLA/MSTR latest-trade requests, with
      explicit source time, freshness, sanitized failures and fallback.
- [x] Verify failure/recovery, selection races, demo and real APIs, types and
      repository checks; preserve the four unrelated user modifications.

Acceptance: the owner's original Chrome page displayed the research charts
after the endpoint change, along with a Coinbase BTC last-trade price and source
timestamp. Real BTC/TSLA/MSTR quote requests returned Coinbase/Alpaca data;
equity trades after the close remained explicitly stale. Demo refresh and
MSTR selection/research navigation were exercised, and the price strip was
visually checked. Both type checks and 74 focused tests pass. The complete
hermetic run reported 7,326 passing, four skipped and three failing tests: two
pre-existing Codex command-expectation failures, plus a research warning-copy
assertion. The latter was updated to the new failure wording and passed in the
final focused run. The unrelated user changes remain excluded from delivery.

## TypeSafe prospective research — 2026-09-20

The owner requested TypeSafe/Jev integration and short/medium/long trend
assessment, and explicitly placed the API key entry in Settings → AI Provider.
Chosen UI: an independent research-provider card on that existing page, with
an encrypted local credential, connection test and opt-in daily collection.
The monitor gets a responsive three-column forecast card (one column on mobile),
explicit horizons, probability bars, evidence timestamps and retrospective
comparison. Shared buttons/forms and labelled inputs retain keyboard access.
This does not add a chat runtime or change the deterministic market strategy.

Pin Jev's version; persist questions, numerical public evidence, issue time
and responses before evaluation. Begin outcomes at the next session open,
count 1/7/30 BTC days or 1/5/20 equity sessions, and retain a fixed ±0.25%
flat band. Compare matched samples with the original rules and always-up
baseline. Show abstentions, missing data and sample counts. Raw model output
is uncalibrated; precision is not evidence of improved predictive accuracy.
No automatic live-rule changes or trading actions are in scope.

Each horizon asks return direction and evidence adequacy independently. The
up/flat/down probabilities sum to one; abstention is not a fourth market
outcome. Three-outcome Brier includes all matured distributions, even when the
separate evidence check abstains. Directional hit rates expose that exclusion.

Implemented and accepted locally: sealed provider settings, real classification
probe, prospective forecast ledger, independent evidence checks, opt-in daily
collection, matched retrospective evaluation and manual public-source claim
audit. Both typechecks and 113 focused tests pass. The full hermetic run had
7,362 passing, four skipped and three failing tests. The new semantic-color
violation was repaired and its owner gate passes in the final focused run.
Two existing Codex command-expectation failures reflect the four pre-existing
user-modified files; those files remain untouched and excluded from delivery.

Real browser acceptance covered the live settings and dashboard empty states,
plus demo forecasts, abstention, retrospective expansion and proposition
audit. Real BTC scanning succeeded with Coinbase daily/hourly data. Its
verified archive produced 399 closed daily and 179 closed hourly observations
for Jev, excluding the current partial candles. Live Jev acceptance still
requires the owner to enter their key through the delivered form; the public
settings endpoint currently reports unconfigured. No secret was read into this
task and no claim of a successful real Jev evaluation is made.
