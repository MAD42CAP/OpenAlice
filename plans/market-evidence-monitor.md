# Market Evidence Monitor

Status: operational health and sustained-run performance increment verified on
`MAD42CAP/OpenAlice:feature/market-evidence-monitor`; live Mac acceptance remains.

Related issues: none.

Owner guides: [[docs/market-data-architecture.md]],
[[docs/ui-interaction-and-motion.md]], [[docs/development-workflow.md]].

## Scope

Build a read-only evidence monitor for BTC and TSLA inside the existing Market
web shell. Reuse BarService for attributed daily and hourly candles, compute
observable price/volume evidence without claiming to know a market actor's
intent, persist settings/observations/alerts under the OpenAlice data root, and
present the result as a responsive dashboard with deterministic demo data.

## Decisions

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
- [ ] Check the updated dashboard visually on the Mac (cloud browser blocks localhost).
- [ ] Verify decision-scale BTC fingerprinting with consecutive live scans.
- [ ] Run the live command on macOS and observe scheduling for 24–72 hours.

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
  process shutdown remain part of the native Mac acceptance gate.
- The first real fresh-clone Mac attempt exposed a missing
  `@traderalice/connector-protocol` `dist` entry after `pnpm install`. Repeating
  that state locally now runs the automatic dependency build first; the full
  demo UI resolved 3,925 modules and completed successfully.
- The focused monitor closure still passed 15 files and 79 tests after the
  fresh-clone launch repair.
- Managed Linux could not run Guardian's `tsx` IPC pipe (`EPERM`) for the full
  source-dev stack. This is the previously recorded host restriction; the
  missing-package build and complete Vite import graph both passed.

The branch is complete when BTC and TSLA can be scanned read-only, duplicate
snapshots are suppressed, source failure is visible without erasing the last
good view, the 1D/1H dashboard and histories work in demo and production paths,
all proportional tests pass, and the verified branch is pushed for Mac review.
