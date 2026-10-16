# Market Evidence Monitor

Status: core platform implemented and live on the Mac. Quality hardening and
sustained acceptance are active on `MAD42CAP/OpenAlice:feature/market-evidence-monitor`.
No integration, merge or release is authorized.

Related issues: none.

## October 14 concise dashboard and accuracy review

The owner requested a substantially simpler result-first dashboard and another
audit of recent judgments against realised market moves. Preserve all archived
predictions, return targets and independent model attribution. No trade, model
promotion or retrospective weight fitting is authorized by this increment.

Selected interaction: retain one page with a compact live quote, one dominant
conditional judgment, three horizon choices, one sentence of evidence/risk and
a compact retrospective verdict. Put independent rule/Wyckoff/model analyses,
research charts, thesis management and operational diagnostics behind initially
closed, labeled disclosures. Reuse shared Collapsible/Button primitives and
theme tokens. Hidden contents must not enter keyboard navigation; failures,
stale evidence and meaningful data gaps remain visible in summaries. Stack on
narrow screens with readable controls, not smaller type. This autonomous choice
implements the owner's requested simplicity; separate routes would add
navigation and a pure deletion would remove evidence needed for review.

- [x] Audit latest matured forecasts using original windows and matched baselines.
- [x] Simplify the default page and retain accessible, attributed evidence on demand.
- [x] Surface a short accuracy verdict with sample counts and uncertainty.
- [x] Correct confirmed evaluation defects without changing historical predictions.
- [x] Complete focused/full regression, typechecks, real API and responsive browser acceptance.
- [x] Record findings and prepare verified delivery only to the owned feature branch.

Audit through October 14: original Jev short hits are BTC 5/23, TSLA 6/17 and
MSTR 2/17; medium hits are 0/17, 2/13 and 3/13. Long windows have not matured.
Rule-v2 short direction support is 2/8, 2/9 and 6/14, versus same-cohort
always-bullish 5/8, 4/9 and 7/14; weekly support is 7/18, 7/12 and 3/13,
versus 8/18, 7/12 and 3/13. These method-specific cohorts are not a head-to-head
ranking or a trading win rate. Six matched short/medium Brier comparisons all
favor historical frequency over both Jev variants. MSTR challenger hits 10/15
and 7/11 match its frequency baseline; higher hits than the original do not
establish incremental predictive value. Samples remain small and overlapping.
Continue prospective, fixed-version comparison before altering judgment weights;
retain Jev as an independent experiment and prioritize verifiable evidence
checks over interpreting its raw probabilities as an established forecast.

The confirmed evaluation defect was binary floating rounding at the inclusive
0.25% boundary: 100.07 to 100.320175 was wrongly scored as directional support.
Decimal now gives the intended flat verdict in both rule review and the matched
always-bullish baseline. Exact positive/negative boundaries and just-outside
prices are covered. All 137 currently completed rule outcome records retain
their previous verdicts; the fix does not inflate the observed results.

Acceptance: 99 relevant tests pass (40 backend, 35 existing UI, 24 new summary
and hook cases); root and UI typechecks pass. The complete suite reports
7,464 passing, four skipped and four failing tests. These are the previously
documented two Codex AI-config expectations against preserved user changes and
two Supervisor TUI PTY failures; no full-suite green is claimed. There are no
new failing tests in this increment.

Final real read-only BTC, TSLA and MSTR scans succeed using Coinbase/Alpaca,
with healthy derivatives/SEC feeds and matching judgment snapshot identities;
all three input replays verify. All 75 original Jev forecasts compare equal to
the initial audit reports. Desktop acceptance shows price, three directions
and retrospective text on the first screen. Production and expanded demo
charts both keep a 390px page width at a 390px viewport. Keyboard disclosure,
asset resets, hourly selection, chart-to-history replay and hidden-editor draft
retention are verified. Demo data remains labeled and no real thesis is edited.
The temporary tabs/server are closed, original TSLA selection and viewport are
restored, and the detached production platform remains running. The four
pre-existing user files remain byte-equivalent and excluded from delivery.

Owner guides: [[docs/market-evidence-monitor.md]],
[[docs/ui-interaction-and-motion.md]], [[docs/testing.md]].

## October 7 judgment-quality and continuity increment

The owner accepted the live audit and requested implementation. Preserve the
original Jev/challenger protocols, archived predictions and return boundaries;
small overlapping samples do not justify fitting weights or probabilities.
This increment makes discrepancies measurable and fixes misleading completeness
and consensus semantics. No additional model request, automatic promotion or
trade capability is introduced.

Selected UI: show all three current evidence directions together as accessible
horizon buttons, with a weekly detail view by default. Put same-cohort model
estimates/observed hits and paired historical-frequency comparisons ahead of
their existing disclosures. Retain independent Wyckoff and model panels. Use
shared Button and existing theme tokens, stack on narrow screens, preserve
keyboard selection and label states in text. This compact change is preferred
to replacing the dashboard or hiding the independent analyses.

- [x] Add same-cohort estimate/hit gaps and matched frequency hit counts to read-only reports.
- [x] Distinguish earnings coverage unknown from failed requests; select the earliest valid upcoming date; warn in unified judgments without adding a directional vote.
- [x] Detect observed scheduled gaps and overdue tails; manual scans cannot hide them; support a seven-day report.
- [x] Correct two-of-three alignment wording and expose all three current horizon directions together.
- [x] Complete regression, root/UI types, full-suite, live API, desktop and narrow demo acceptance.
- [x] Record acceptance and prepare delivery of only this increment on the owned feature branch, preserving the four unrelated user edits.

Acceptance: the final focused suite passes 141 tests across 16 files; root and
UI typechecks pass. The full suite with local networking available reports
7,430 passing, four skipped and five failing tests. Two Codex AI-config command
expectations remain affected by the owner's preserved environment-forwarding
edits; two Supervisor TUI PTY failures are previously documented. The additional
connector navigation scroll assertion passes both in isolation and in the
complete connector test file. No connector/terminal/adapter source is changed
by this increment; full-suite green is not claimed. A successful-empty calendar
cache regression was added after the full run and passes in the final focused
suite. GitHub Issues remain disabled as documented in the preceding acceptance.

Final live read-only BTC, TSLA and MSTR scans succeed using Coinbase/Alpaca, with
healthy derivatives/SEC feeds and matching judgment snapshot identities. Equity
calendar/news requests are successful while earnings coverage is explicitly
unknown and judgments remain partial. Successfully empty results clear cached
calendar/news rather than reviving them after a later failure. All 57 original
Jev forecasts compare equal to the audit copies, and actual scan input replays
verify. Seven-day reports reveal both the roughly 18h50m and 32m observed
scheduled gaps without claiming uptime or exact missed dispatches. Desktop and
390px demo acceptance passes with no page overflow; keyboard horizon selection
includes direction descriptions. The temporary demo server is stopped and the
detached production platform remains running. Secret-pattern and whitespace
checks pass; delivery excludes all four pre-existing user edits and targets only
`MAD42CAP/OpenAlice:feature/market-evidence-monitor`.

Owner guides: [[docs/market-evidence-monitor.md]],
[[docs/ui-interaction-and-motion.md]], [[docs/testing.md]].

## September 23 thesis tracking increment

Implement the accepted first phase of the investment-assistant comparison:
user-authored per-asset thesis, versioned supporting/invalidation conditions,
deterministic checks and an attributed historical check journal. No automatic
research, preference learning, trading, forecast tuning or news inference.
New additive state under `market-monitor/thesis-v1` does not migrate or rewrite
existing observations. Manual text conditions remain unknown. Numeric conditions
test a single latest completed observation; persistence/duration rules are not
implied. Revisions use optimistic concurrency and immutable publication.

Autonomous UI choice: one compact card beneath the unified judgment, with a
status summary and existing Collapsible/Button/Textarea primitives and styled native fields for
evidence, edit and history. A separate page would hide context and add navigation;
an always-open editor would overload the dashboard. Stack fields on narrow
screens, label every control, retain text status and keyboard access. Backend
reads/writes belong to a domain hook and the presenter receives props. No sample
thesis is activated on the user's behalf. Demo data is explicitly illustrative.

- [x] Add bounded metric catalog, freshness-aware evaluation and immutable revisions/checks.
- [x] Wire isolated post-scan checks, validated API, domain hook and responsive UI/demo.
- [x] Test concurrency, history, units, stale/missing data, failures and asset changes.
- [x] Complete type/full-suite, real API/browser acceptance and prepare owned-branch delivery.

Acceptance: 87 focused tests and root/UI typechecks pass. The final full run
reported 7,418 passing, four skipped and four failing tests: two existing Codex
adapter command expectations affected by the owner's uncommitted environment
forwarding, and two existing supervisor TUI PTY assertions. An earlier issue
session timing failure passed in isolation and in the final full run. The last
missing-input regression was added during that run and verified by the final
focused suite and root typecheck. GitHub issue filing returned HTTP 410 because
Issues are disabled; no repository settings were changed.

Live BTC, TSLA and MSTR read-only scans succeeded using Coinbase/Alpaca. Isolated
thesis archives checked their actual snapshots, revisions, conflicts, immutable
history and restart reads; MSTR's official net-BPS mNAV evidence was verified.
The real thesis archives remain empty until the owner records a thesis. Browser
acceptance covered the live empty state/editor, demo invalidation and original
version history, and the 390px layout. Four unrelated user edits are preserved
and excluded; only the owned feature branch is selected for delivery.

Owner guides: [[docs/market-data-architecture.md]],
[[docs/ui-interaction-and-motion.md]], [[docs/development-workflow.md]].

## September 20 unified judgment increment

The owner accepted a single prominent assessment with independent platform,
Wyckoff and Jev analyses retained below. Selected interaction: weekly default,
explicit day/session horizon buttons, one direction plus its main reason,
confirmation/invalidation conditions and a disclosure for each input's role.
Use existing Button/Collapsible and theme tokens, wrap controls and stack
conditions on narrow screens, retain keyboard/ARIA semantics. No new settings,
navigation hierarchy, provider calls, trading or model cost is introduced.

Composition is a versioned read-time evidence summary rather than an averaged
probability. Candidate structure is not a vote; confirmed opposition withholds
direction. Missing/stale core data blocks the relevant horizon. Context and
independent Jev differences remain attributed. Archived predictions are not
changed or reconstructed by this presentation increment.

- [x] Implement the domain composition and read-only endpoint with isolated Jev failures.
- [x] Add the responsive headline, explicit horizon selection and independent analyses.
- [x] Add demo, selected-asset/stale-response tests, conflict/freshness tests and typechecks.
- [x] Verify the live Mac and narrow deterministic demo surfaces.
- [x] Complete final full-suite audit and live three-asset acceptance.
- [x] Prepare verified delivery restricted to the owned feature branch.

Acceptance: 42 focused tests and both root/UI typechecks pass. The complete
hermetic suite recorded 7,378 passes, four skips and two failures in the existing
Codex adapter AI-config command expectations. Those failures match the owner's
pre-existing, uncommitted environment-forwarding edits; those edits are preserved
and excluded from this increment. The final earnings-date regression was added
after the full run and passed in the focused suite. Live read-only BTC, TSLA and
MSTR scans all succeeded, with matching snapshot identities in the new endpoint.
The live route and deterministic demo were checked, including a 390px viewport.

## September 22 prospective performance audit

Audit the original Jev/rules publications against only matured forward windows.
The live sample is too small to tune prediction thresholds: each asset has just
one matured Jev short call, all published September 20 and evaluated September
21. All selected flat and all outcomes rose beyond the fixed 0.25% boundary.
The current 27 horizon calls contain 22 flat choices. Weekly/monthly Jev windows
have not matured. Rules summaries also overweight identical Monday windows from
separate weekend publications, and the Jev comparator incorrectly equates the
rules' descriptive sideways label with a ±0.25% return prediction.

Selected UI treatment: retain existing review disclosure/tables and add a
compact visible maturity/result line to the Jev panel; disclose duplicate
windows and flat-choice counts inside review. Existing theme tokens and wrapping
text suffice; no new navigation or interactive primitive. Do not rewrite any
forecast, widen flat thresholds after observing misses, tune rule weights or
give the uncalibrated model control over the combined headline.

- [x] Correct paired baselines and score only the earliest publication per identical outcome window.
- [x] Expose maturity, duplicate counts and flat-call concentration, with matched demo/UI tests.
- [x] Verify regression/type/full-suite gates and real reports; prepare delivery to the owned branch.
- [x] Prepare an audit distinguishing realised accuracy, directional coverage, descriptive structure and still-pending horizons.

Acceptance: 44 focused tests and both root/UI typechecks pass; the final UI copy
also passed the 10-test UI subset. Live read-only BTC, TSLA and MSTR scans passed,
and actual reports show the corrected cohorts (BTC rules 1/3, MSTR rules 1/3,
TSLA no directional score; one matured Jev short miss per asset). Checked the
live route and deterministic demo including 390px wrapping. The full suite
recorded 7,380 passes, four skips and four failures: two existing Codex adapter
AI-config expectations against preserved user changes, and two Supervisor TUI
PTY failures (pointer timeout and inbox-count text mismatch). The latter two
also failed in a focused rerun with a temporary supervisor state directory;
no terminal UI source is changed by this increment. Full-suite green is not
claimed. Prediction prompts, probabilities, thresholds and archives remain
unchanged; this increment corrects evaluation, not predictive performance.

## Scope

### September 22 forward comparison increment

Keep the original Jev input/output contract unchanged. Add one daily shadow
challenger per asset using the same archived price evidence, fixed return
targets, completed historical return frequencies and volatility, plus three
atomic price/volume evidence checks. Do not promote it into the headline.
Save the original Jev forecast and the current combined judgment before the
challenger request in a separate immutable experiment journal. Candidate
failures cannot remove that publication; retries cannot rewrite either record.
This is new opt-in research state under the already enabled automatic Jev
setting, not a conversion or backfill of shipped historical records. Automatic
collection adds at most one successful challenger call per asset/session, with
single-flight and bounded failure cooldown. Same-session/same-evidence pairing
and identical forward windows are required; current prices are not outcomes.

Selected UI: a compact comparison panel below independent Jev, one daily
collection button and a disclosure for the original/challenger/rules/combined
scores, historical distributions and atomic checks. Reuse existing Button,
theme tokens and semantic tables with wrapping/scrolling on 390px screens.
Keep the accepted headline unchanged. No new trade permissions or settings.

- [x] Implement historical context and immutable paired publications.
- [x] Add read-only future evaluation, paired scores and UI/demo surfaces.
- [x] Validate leakage, missing sessions, reuse, errors and real collection.
- [x] Complete type/full-suite gates and prepare owned-branch delivery.

Acceptance: 41 focused tests and root/UI typechecks pass. The full suite ran
7,391 passes, four skips and five failures. One was an AI-provider loading
test's unmocked independent TypeSafe settings request; that nondeterministic
test boundary is now isolated and passes in the final focused run. Four remain
the previously documented Codex adapter/terminal UI failures outside this
increment. The full suite was not rerun after the test-only isolation fix.

The live scheduler collected one original/challenger/combined group per asset
on September 22, all with valid hashes. Repeated collection reused IDs/hashes;
all nine old Jev records remain byte-equivalent at the forecast-hash boundary.
Three further real scans succeeded (Coinbase BTC, Alpaca equities, healthy SEC),
without changing the archived experiment. All new forward outcomes are pending.
The nine price/volume evidence classifications matched independently computed
facts, which does not validate the nine future trend choices. Some challenger
probabilities exceeded 90%; no calibration or accuracy improvement is claimed.
Live desktop and 390px deterministic demo acceptance passed. The first combined
short labels are insufficient because original hourly evidence is older than
collection; the UI explicitly distinguishes this same-evidence archived
assessment from the newer live headline.

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

## October 14 three-layer investment intelligence

The owner requested a complete additive BTC research pipeline, preserving the
existing BTC/TSLA/MSTR monitor, historical forecasts and native AI configuration.
Layer one normalizes dated market evidence. Layer two imports public Glassnode
Week On-chain reports and persists immutable source material separately from AI
interpretations. Layer three uses one existing native Workspace Issue to analyze
both layers, publishes three independent horizon views, cross-validates evidence,
and tracks objective preregistered conditions without changing past forecasts.

Chosen interaction: BTC gets three tabs on the existing page — 市场监测,
链上研究 and AI综合研判. The existing concise market view stays the default;
research and synthesis lead with one conclusion and show detail on demand.
Keep the original market content mounted but inert when hidden, so switching
tabs preserves unsaved thesis work. Reuse shared Tabs, Collapsible and Button,
show source/data/analysis dates, provide URL/text import and explicit job/error
feedback, and stack controls at 390px. Stocks keep their existing experience.

One native Issue owns generation; no separate LLM loop or three-agent runtime.
Only that authenticated Issue run may obtain private source text or publish.
Frozen inputs bind publication to source hashes, evidence identities and run
provenance. Daily discovery catches up at startup, while successful scans
revalidate saved conditions and request regeneration only for changed inputs.
Missing, stale, conflicting or future evidence cannot become confirmed facts.
Historical Jev return targets and existing user-authored thesis records remain
unchanged. Qualitative evidence status is never a future-price probability.

- [x] Implement bounded legal public discovery, source archives and versioned research.
- [x] Implement normalized market evidence, guarded synthesis and objective AI thesis tracking.
- [x] Connect one native task, scoped publication tools, APIs and three-tab UI/demo.
- [x] Test stale/conflicting/future inputs, deduplication, immutable histories and authorization.
- [x] Verify real Week 41 import, native analysis, BTC scan and responsive UI; run owner gates.
- [x] Document operating behavior and limitations; sync only the owned feature branch.

Acceptance: the real public Week 40 and Week 41 reports were discovered and
imported in publication order. Native Issue run `run-N9jnHgmv` published two
Chinese ten-section ResearchSnapshots, three source-linked weekly comparisons,
one independent three-horizon synthesis and two preregistered AI theses. The
cross-validation results include partial support, conflict and unverified
inputs; unknown cutoff dates remain visible. Both theses currently await new
completed observations (CHALLENGED), not retrospective claims of success.
Repeating the Week 41 URL keeps counts at two reports/two analyses/one synthesis.

Real manual BTC, TSLA and MSTR scans all succeeded: Coinbase/Alpaca daily and
hourly sources, Deribit public context and SEC filings were available. The
private source HTTP path returns 404; full report text stays in local private
archives and authenticated native input only. Production remains running under
the existing detached launcher. Desktop and 390px demo acceptance covered
three tabs, source dates, collapsed detail and historical selection; expanded
research and import controls retain a 390px document width. Source calendar
dates do not shift to the previous day in Vancouver. Temporary demo resources
were closed and the real synthesis page remains available.

The final relevant suite passes 122 tests; both root and UI typechecks and
staged whitespace checks pass. The complete regression reports 7,541 passing,
four skipped and four failing tests, matching the existing two Supervisor TUI
PTY failures and two Codex configuration expectations against preserved owner
changes. The initially found new CLI registration fixture failure was repaired
and passes in the final full run. Additional review regressions cover native
status recovery, cached publication receipts, and all claim references in
freshness/conflict checks. No full-suite green or improved predictive accuracy
is claimed. Paid Glassnode Studio metrics, unsupported market context and a
longitudinal thesis quality cohort remain unavailable or not yet mature.

Only this increment is delivered on the owned feature branch. Four pre-existing
owner modifications stay outside the commit; the two touched CLI files stage
only the new intelligence mappings and fixture registration. No secrets,
private reports or runtime records enter Git, and no upstream change or trade
is performed.

## October 15 primary research navigation

The owner requested the investment platform outside the Market directory and
at the front of the main navigation, named 投研平台. Selected interaction:
add a first primary activity, research, that opens the existing market-monitor
view directly with no Market secondary navigator. Use /research as its canonical
URL and retain /market/evidence as an adopting alias for existing bookmarks.
Saved monitor tabs keep their identity and keep-mounted lifecycle. Other Market
news, boards, analytics and trading destinations retain their own names.

The same entry, accessible label and selected state apply to expanded/compact
rails and the mobile drawer. Reuse existing navigation buttons and shell header
controls. Add research to both layout catalogs; default and older layouts missing
the new entry receive it first in primary, while existing custom ordering and
visibility remain respected. This is an additive catalog entry, not a new state
format or research-data migration. Nano continues to hide trading-data surfaces.

- [x] Move and rename the entry, remove the old Market child, preserve deep links.
- [x] Verify layout persistence, selected state, types, regression and real desktop/mobile.
- [x] Keep delivery on the owned feature branch, retaining pre-existing owner changes.

Acceptance: the real page opened from the old URL adopts `/research`, with
Investment Research first in the main rail, one current selection, and no Market
secondary navigator. Market overview retains its directory without a duplicate
monitor entry. The real layout API returns research exactly once, first in
primary. The 390px mobile drawer opens the same first item and closes on
selection; the independent page is 390px wide with no horizontal overflow. At
820px the compact rail retains its icon/label and a single primary expand
control. Demo `/research` also works. Temporary demo resources and viewport
overrides were removed, and the real platform remains running.

Both typechecks pass. The final complete UI owner suite passes 2,041 tests;
141 focused navigation/layout/monitor tests and the three pointer-sort tests
also pass. The initial complete hermetic run recorded 7,552 passing, four
skipped and seven failing tests. Three UI failures found during editing were
repaired (Chinese title mismatches and the old drag-coordinate fixture); the
final complete UI run has no failures. The four previously documented PTY and
Codex configuration failures remain outside this increment; no full-suite
green is claimed. The original four owner modifications remain excluded.

## October 15 forward judgment revision

The owner authorized implementing the BTC audit's findings. The retained
original Jev overpredicts the narrow +/-0.25% return class; the old combined
record adds no matched directional hits, and the new qualitative AI thesis
cohort has no completed forward observation. Those are descriptive findings,
not authority to fit a successful strategy to this month.

Selected implementation: keep all v1 archives and evaluators unchanged. Add
`market-forward-v2` in its own immutable directory, with a frozen publication
and separately appended Jev candidate. Supply same-target, past-only base
rates, keep raw probabilities, ask signal uncertainty separately from data
quality, and apply an explicitly experimental abstention guard to unsupported
flat inflation. Never force an uncertain result into up/down or alter an old
target. Track raw Brier even for abstained decisions; report coverage and exact
common-window comparisons separately. Existing scheduled scans collect the
new version once per session; manual retry may fill an absent candidate on
its original basis without replacing the publication.

The current deterministic summary gets a versioned conditional/abstaining
decision gate. The separate native AI synthesis binds evidence to its horizon
and family, degrades unknown/stale/conflicting support and its effective
headline together, retains raw proposals, and advances its analysis version.
Price-derived methods and a report repeating price do not become independent
confirmation. Existing qualitative theses retain their original conditions.

UI choice: preserve the current compact layout and shared Button/Collapsible
primitives. One short new-version validation status and effective Jev stance
remain visible; raw percentages, old-version results and detailed coverage
stay collapsed. Conditional bias is labelled pending confirmation. Keep the
390px layout readable and keyboard access to disclosures intact. No new chart
or trading workflow is introduced.

- [x] Implement immutable v2 input, decisions, collection and forward scoring.
- [x] Guard current and native AI synthesis with explicit version boundaries.
- [x] Add the compact UI, API/demo support and meaningful regression tests.
- [x] Run types and full hermetic gates; verify real read-only BTC collection,
  preserved v1 hashes, initial pending outcomes and desktop/mobile behavior.
- [x] Document operating limits, preserve owner modifications, and sync only
  `MAD42CAP/OpenAlice` on the existing feature branch.

Live acceptance on October 15: scheduled collection produced the first
`market-forward-v2` BTC publication at 20:31 UTC and a separate `jev-1.13.0`
candidate. All three effective decisions abstain for uncertain signal; their
original down/up/up choices and complete probability distributions are retained.
Manual collection returned the same immutable publication and candidate. All
three outcome windows remain pending. TSLA and MSTR also have their first valid
v2 publication; all three assets report zero invalid records.

The final read-only BTC scan completed normally with a duplicate receipt because
the completed evidence had not changed. Both Coinbase bar sources and Deribit
context were available. The current deterministic summary abstains at 1/7 days
and retains a conditional bullish bias at 30 days. Native AI run `run-0CNeK4Nq`
successfully published `investment-intelligence-v2` at 20:42:57 UTC: short-term
range, medium-term uncertain, long-term conditional bullish. These qualitative
windows remain distinct from the fixed-return evaluation.

The actual desktop and 390px pages show concise effective labels, closed details
and separate history. The demo clearly identifies illustrative results. A
review found and repaired stale-session UI presentation; boundary tests cover
UTC BTC dates and New York summer/winter equity dates. Temporary demo resources
and viewport overrides were removed. SHA-256 comparisons confirmed all 157
pre-existing forecast/publication/thesis/evaluation files and the four original
owner-modified source files retained their bytes after the live run. New model
and report data remain outside Git. No predictive improvement is claimed before
subsequent completed outcome windows exist.

Validation: both TypeScript checks pass. The complete hermetic run recorded
7,604 passing, eight failing and four skipped tests across 871 files. Four are
the pre-existing Codex argument/PTY failures documented above. Four new history
UI assertions encountered old translation-module caches because the UI fix was
written during this run (the failure DOM contained untranslated new keys).
A fresh complete UI owner run removed those failures: 2,060 passed and one
unrelated NewsPage test failed because its observer callback had not initialized.
That untouched file passed all 12 tests on independent rerun and had passed in
the complete suite. All changed UI files pass; the new forward UI separately
passes 12 tests, and the investment guard passes all 24. This is not a claim of
a fully green repository suite. Difference/secret-marker checks pass, with all
four original owner source modifications excluded from the feature commit.

## BTC research feedback loop

The owner authorized connecting Auto Prediction, Jev and Auto Quant research
back to the BTC synthesis. This increment reuses the selected durable desks,
native Issue runs and existing scoped intelligence CLI. It introduces no
parallel agent runtime, broker access or strategy-weight automation.

Selected contract: freeze one provenance-bound input per actual AP/AQ run;
accept a bounded, immutable research card referencing only that input's public
evidence. Jev is projected from the existing immutable forward-v2 candidate,
without issuing a second prediction or changing its evaluation policy. Cards
expire and retain their original input/source hashes. All feedback is inference
and unvalidated; source repetition never establishes independent confirmation.

The next qualitative synthesis version freezes this shared feedback context,
explicitly reviews its IDs and saves a consumption receipt. Cache identity
includes the actual frozen feedback; a concurrently published card cannot be
marked consumed by an older synthesis. Existing publications and fixed-return
forward-v2 scoring remain unchanged. Missing or failed contributors stay visible
without blocking the price scan or falsely claiming a completed loop.

UI decision: a compact feedback strip below the combined assessment, with
available contributor count and a truthful consumed/pending label. One shared
Collapsible contains each source's sentence, timestamp and Update research
button. No extra charts, probabilities or top-level tabs. Shared primitives,
wrapping 390px layout and accessible live status/disclosure controls apply.

- [x] Implement immutable provenance-bound feedback inputs, cards and read model.
- [x] Reuse native AP/AQ Issues and scoped CLI publication; expose read/run API.
- [x] Freeze feedback into synthesis v3 with validated review and consumption.
- [x] Add concise UI, truthful demo and regression coverage.
- [x] Verify full tests/types, live BTC → AP/Jev/AQ → synthesis receipt, unchanged
  historical records and desktop/mobile behavior; sync only the owned branch.

Verification: the complete hermetic suite passes 7,649 tests with four skipped
and only the same four pre-existing Codex/PTY failures (877 files, 875 passing).
No new loop, UI or API failures remain. Root and UI typechecks pass. Focused
acceptance includes 15 domain, seven coordinator, 47 synthesis/tool/route and
54 UI/demo tests. The live native research tasks both published immutable cards:
AP `run-3Qb4eJv9` at 22:06:39 UTC and AQ `run-uTrx9RC4` at 22:06:59 UTC.
Jev is linked to the existing 20:31 candidate; all three are available, not
three independent votes. Both cards honestly report inconclusive findings.

The first native synthesis froze before AQ published and correctly reviewed
only AP plus the three Jev horizon references. Its context hash did not match
the later five-reference context, so the UI retained pending status. A real BTC
read-only scan requests the next synthesis through the existing material-key
path, exercising concurrent late-feedback handling rather than rewriting the
first receipt. Final consumption acceptance follows below.

Final live acceptance: the successful Coinbase/Deribit BTC scan stored snapshot
`730f84f4-5044-4f27-97d3-c66472441947` and automatically dispatched
`run-OY7D4mSh` at 22:09:18 UTC. It completed at 22:11:28 UTC and published
synthesis v3 reviewing both native cards plus all three Jev horizon references.
Its receipt exactly matches current context
`71be4aaaa197f54dc58eff7dfc06f75095e5191a13ee95c3db915c4b9c4f0a0d`.
The real page shows 3/3 available and reviewed in synthesis, with zero invalid
records. Its AI conclusion remains uncertain across all qualitative horizons;
no predictive improvement or automatic weighting is claimed.

Actual desktop, 390px (document and scroll widths both 390), keyboard disclosure
and clearly labelled demo/update/stocks behavior were verified. Details remain
closed by default. Temporary demo process/tab and viewport overrides were
removed. Hash comparisons preserve all 165 pre-existing experiment, forecast,
publication, thesis and evaluation files, including the forward-v2 candidate;
the four owner-modified files remain byte-identical and excluded. Secret-marker
and diff checks pass. Runtime research archives and credentials are not in Git;
delivery stays on the owned feature branch without a PR or upstream write.

## TSLA / MSTR research-loop extension (2026-10-15)

The owner selected extending the established BTC loop to both equities. Reuse
native Auto Prediction, Jev forward-v2 publications and Auto Quant, then freeze
those contributions in each asset's qualitative synthesis. Bind every input,
Issue, source, archive and receipt to its own asset. Keep BTC protocol, hashes
and shipped archives unchanged. Equities use their own additive namespaces and
version; never manufacture a Glassnode analysis or count AI feedback as an
independent observation. Use completed exchange bars and expose stale/missing
company-event evidence honestly. This is read-only research, with no automatic
strategy-weight or trading changes.

Selected interaction: retain the compact contributor/review strip for all three
assets. BTC retains its existing research tab; equities expose Market and AI
synthesis only. Details remain in a shared Collapsible, with accessible status
and keyboard controls and wrapping mobile layout. This autonomous implementation
choice follows the owner's request for a simple dashboard, not a new approval.

- [x] Extend asset-bound projection, feedback, provenance and immutable storage.
- [x] Wire native AP/AQ and qualitative synthesis per equity, scoped CLI and API.
- [x] Extend simple UI, selection isolation and explicit per-asset demo.
- [x] Verify focused/full tests, types, actual readonly scans and native exact
  consumption receipts; preserve historical records and unrelated edits.
- [x] Sync only MAD42CAP/OpenAlice feature/market-evidence-monitor.


Equity verification in progress: both real scans succeeded using Alpaca daily
and hourly bars and SEC EDGAR, with no trading/account access. Native AP and AQ
have published TSLA cards; existing Jev v2 is projected as abstention rather
than flat. A first synthesis correctly consumed only the four references
available when frozen, leaving the later fifth reference pending. MSTR native
research follows in the same selected desks. Stock schedules were staggered
TSLA16:20/16:25/16:40 and MSTR16:40/16:45/17:00 New York to respect shared
single-run desk occupancy. Only this turn's exact generated defaults were
repaired in live Issues; customized cadence remains untouched.

The first complete hermetic run passed 7,719 tests with four skipped, and only
the four previously recorded Codex-adapter/PTY failures (879 files;877 passing).
Root/UI typechecks pass. Browser/demo checks found two presentation labels to
correct before the final full run: asset-specific tablist attribution and
trading-session wording for equities' qualitative short window.

Acceptance also observed an existing Workspace runtime-settings read/write
race: native dispatch had succeeded, but detail enrichment transiently read
partial JSON and returned500; authoritative task status prevented duplicate
admission. This is outside the asset-loop change. Filing a sanitized follow-up
in the owned GitHub repository was attempted; GitHub returned410 because Issues
are disabled. No repository settings or credentials were changed.


Final equity acceptance: both actual native cycles completed successfully.
TSLA AP `run-SdULOAPm` published at03:29:31 UTC and AQ `run-FR9rEqGT` at03:30:37.
Its real readonly rescan stored `fee728e6-0764-4095-b080-1672d6e84b62` at03:36:19,
then automatically requested `run-LWvZxlf8`, which published at03:39:33 and
completed normally. All five frozen research IDs were reviewed, with exact
context hash `bc8f41df727565f08eeb8d6b8a069676bb8a7d898333ec56f4120d2dbc748398`.

MSTR AP `run-PF1FAcbx` published at03:32:58 and AQ `run-gwLXT7f1` at03:35:01.
The later AQ card requested native synthesis `run-xscmlwMF`; it published at
03:40:06 and completed normally. Its five-ID receipt exactly matches
`e602d3866dc5679829507a8b4e7b9f34c52d2624e89aed7e6a5608cec3063efa`.
Repeat readonly scans correctly returned duplicate receipts for the unchanged
completed-market snapshot `b80c4a07-6b1b-47ee-81e3-a26269962e38`, including
03:38:46; they did not rewrite its historical capture time. All three
contributors are ready for each equity; zero invalid records and no crossasset
citations or BTC report IDs. Jev remains current-session abstention.

Both assets' daily/hourly bars are Alpaca, through the Oct15 daily and20:00 UTC
hourly basis. SEC was healthy on the initial scans and remains healthy for
MSTR. A later TSLA SEC network/response refresh failed; the old metadata was
explicitly retained as display-only, excluded from current stock projection
and disclosed in native synthesis limitations. This did not block price
scanning or falsely promote old filings into current confirmation.

Final effective qualitative summaries: TSLA conditional bearish/uncertain/
conditional bearish; MSTR uncertain/uncertain/conditional bearish. These use
their declared qualitative windows, not the main fixed-return forward windows.
The AP/AQ cards and three Jev references increase caution, not independent votes
or measured accuracy. No future outcomes exist yet to prove improvement.

After all source and label changes froze, the full suite again passed7,719
with four skipped and only the same four preexisting Codex/PTY failures
(879files;877passing;383.49seconds). Root and UI typechecks pass; final focused
UI40 and domain/service/tool/router/coordinator regressions pass. Real desktop,
390px actual/demo (client and scroll widths both390), stock tab switching,
collapsed evidence, BTC's retained third tab and illustrative update behavior
were verified. Actual TSLA/MSTR pages show3/3 available and reviewed. Temporary
browser viewport and demo tab/server are cleaned up. The four owner-modified
files and177preexisting immutable archives remain byte-identical and excluded;
secret-material and diff checks pass. No PR, upstream write or trading action.

## SEC and platform stability follow-up (2026-10-15)

The owner explicitly requested fixing the transient TSLA SEC refresh and the
four remaining test failures, then verifying continued platform operation.
Preserve existing files and immutable market/research history. The current
Codex adapter edit is a directly related dependency of the two failing tests:
retain its bytes and include that behavior with its corrected contract tests.
The three unrelated CLI/narrator edits remain outside this delivery.

- [x] Classify SEC network/timeout/status/format errors, add bounded compliant
  transient recovery, preserve cooldown and explicit stale reference behavior.
- [x] Fix Codex launch contract regressions without dropping scoped routing or
  provenance and without projecting credentials into CLI arguments.
- [x] Make PTY fixtures genuinely isolated from real Inbox and localhost state;
  retain actual pointer/keyboard assertions rather than weakening them.
- [x] Repair the observed native runtime-settings partial-JSON read/write race
  with atomic publication and concurrency coverage, keeping the schema intact.
- [x] Run affected suites, required typechecks, complete hermetic tests, real
  readonly SEC refresh/scans, native scheduling and background/browser checks.
- [x] Verify owner/history fingerprints and prepare owned feature-branch delivery.

No dashboard redesign is needed; existing concise statuses and collapsed
source details stay in place. No new credentials, trading rights, model engine
or parallel scheduler are introduced.


Stability implementation: SEC now distinguishes safe transport/timeout/HTTP/
JSON/schema failures, retries one recoverable failure within a 12.5-second total
budget and keeps both causes if attempts fail. All attempts share the existing
one-per-second gate; 403 is never retried during a refresh, and its 15-minute
restriction/long Retry-After survive competing errors. A stalled body or
transport cannot hold the scan indefinitely or inject a late success. Pending
aborted work stays explicitly tracked until settlement, preventing overlap.
No contact values, headers or arbitrary server/error bodies enter diagnostics.

The two Codex assertions now reflect the already-intended routing/provenance
bridge, including closed non-secret env projection, TOML escaping, fresh/resume
and interactive/headless/Web coverage. The existing codex.ts bytes are retained
as the delivery dependency. The other three owner edits remain excluded.
PTY fixtures now always inject Inbox/read-state/health dependencies, including
the zero-unread case; accidental fetch fails closed and state paths use the
isolated test home. Existing mouse geometry and tiny-layout assertions remain.

Runtime settings publication uses a dedicated atomic writer only after strict
secret-free schema validation. Readers see complete old or new JSON, failed
writes preserve the previous file, permissions/symlink behavior stay guarded,
and scratch data is cleaned. Independent review identified credential-config
Git exclusions as an important boundary, so all native credential/config
writers deliberately retain their original target-file seam. A regression
asserts those paths create no sibling scratch copy. The settings schema and
within-process update serialization are unchanged.

Initial full suite: 880 files passed;7,752 tests passed,4 skipped,zero failures,
377.56 seconds. CLI owner: 69 files / 746 tests including 59 PTY journeys pass; Codex
adapter/env/runtime closure 19 files / 363 tests passes. SEC/context/monitor 65 tests,
Workspace/API atomic closure 42 tests and final focused atomic/adapter 153 tests
pass. Root, UI and CLI typechecks pass. After narrowing the atomic writer to runtime
settings alone, the final full suite passed all 880 files: 7,753 tests passed,
4 skipped and zero failures in 385.51 seconds.

Live readonly acceptance: TSLA and MSTR each refreshed three times at
04:26:54, 04:26:58 and 04:27:01 UTC on Oct16. All six actual scan receipts contain
healthy current SEC source timestamps and six material filings; completed-bar
snapshots correctly deduplicate unchanged evidence without rewriting history.
BTC real scan also succeeds with Coinbase daily/hourly and Deribit. Native
TSLA run `run-H6ZBshzY` completed successfully; 20 concurrent Issue-detail reads
returned 200 without partial-JSON errors. After narrowing the atomic writer,
a second real native TSLA run, `run-9xJ4Frml`, completed with exit code 0 in
119.827 seconds; another 20 concurrent Issue-detail reads all returned 200.
Its published feedback matches the current research context.

Final background status: existing native scheduler is running every 15 minutes;
BTC, TSLA and MSTR remain enabled with no current scan error. The actual TSLA
dashboard shows healthy SEC status and six filings, then is restored to the
concise collapsed view. This is current acceptance evidence, not a claim of
24 hours without any historical interruption; old failure receipts remain.

All four owner-file byte fingerprints and 198 existing immutable market/research
records are preserved. Only the related unchanged Codex adapter is included; the
three unrelated owner edits remain unstaged. The staged delivery passes diff
and secret-material checks. Synchronization uses the owned repository and
feature branch with an expected-head lease; no upstream or trading action.

## Equity-session quality and prospective evidence validation (2026-10-15)

The owner authorized proceeding in order after the three-asset audit: isolate
sparse extended-session stock bars from the rules, improve Jev/combined
validation and evidence use, then verify on real readonly market data.
Existing historical calls, raw probabilities, grades and the three unrelated
owner edits are preserved. Delivery stays on the owned feature branch.

Chosen UI interaction: retain the existing compact conclusion and horizon
selector; add at most a concise current-cohort validation sentence. Detailed
coverage, pairwise comparisons and probability diagnostics stay inside the
existing initially closed disclosure. No new navigation or dense panels.
Keyboard/accessible disclosure behavior and narrow-width layout stay intact.

- [x] Introduce a versioned equity regular-session input policy with explicit
  source-volume scope, retaining raw charts and exact legacy replay.
- [x] Freeze a separate active forward cohort, retain v2 readonly history,
  report fair pairwise comparisons/coverage/calibration with no automatic
  weighting or retrospective regrading.
- [x] Strengthen native synthesis with verifiable same-horizon conditions and
  bounded event-risk handling; retain all original qualitative publications.
- [x] Keep the UI simple and mirror API/demo contracts with focused tests.
- [x] Pass required types, focused and full regression suites; verify real
  stock/BTC scans, Jev collection, native synthesis, replay and responsive UI.
- [x] Verify historical/owner fingerprints, diff/secret checks and prepare
  synchronization of the owned feature branch only.

Cutover discovery: source-backed hot reload ran the existing scheduler while
new code was being assembled. It appended intermediate v3 records (one BTC,
one per stock; the stock basis marker is now correctly unverified). Stop the
real platform during final assembly, preserve every intermediate record and
use a separate final `market-forward-v4` ledger. V2 and intermediate v3 remain
explicitly readonly; no failed or invalid record is deleted or regraded as a
new prediction. Restore the existing background runtime after source freezes.

Implemented input policy: scheduled NYSE 2026–2028 regular sessions, DST and
early closes; full completed hourly buckets only. At least three prior matching
local-time sessions establish a past-only median, and <10%/zero volume is
insufficient evidence. Missing/noncontinuous hours never bridge a gap; the
latest sparse bucket cannot revive an older pulse. Market-open freshness and
post-close expected-session checks are shared by rules, Jev and native evidence.
IEX volume is explicitly single-venue, while raw provider charts remain intact.

Native BTC v4/equity v2 adds exact same-horizon decision conditions, genuine
price anchors, current-hourly admission at publication and a shared five-session
earnings-risk window. Stable admission state participates in equity material
and publication cache identity, so a new open cannot reuse an earlier accepted
short outlook. Missing conditions/events yield uncertainty, not synthetic flat
returns. This does not add verified fundamental-direction sources or claim
forecast improvement. Existing qualitative theses retain their original keys.

First complete regression: 882 files / 7,837 tests passed, four existing skipped,
zero failures (403.82 seconds). Real BTC/TSLA/MSTR price scans and v4 Jev
collections succeeded; all new publications have pending future outcomes.
Three original v2 archives and new v3 analysis archives replay as verified.
A transition-only MSTR snapshot shared the semantic fingerprint but retained
basis2; deduplication now compares the complete analysis-basis identity so a
new basis3 record is saved without altering the old one.

Final acceptance additionally checks historical research-loop identity across
forward protocol versions: an old frozen v2 input must reconstruct its original
Jev references and original hourly admission, while current context must use the
new availability policy. Retaining valid historical provenance never makes an
old extended-session hour current directional evidence.

Final regression before the last focused clock-boundary correction: 882 test
files / 7,845 passed, four existing skipped, zero failures (388.21 seconds).
The final request-time Jev freshness correction separately passes three files /
54 tests, including pre-open capture requested after the next open or close;
legacy v2 request-time semantics remain unchanged. Final root and UI TypeScript
checks both exit 0. Readonly cross-review found no further concrete blocker.

Actual acceptance: all three assets scan successfully; BTC uses Coinbase daily
and hourly plus Deribit, stocks use Alpaca IEX plus healthy SEC submissions.
Each has one valid new v4 publication, zero invalid new records, and pending
1/5/20-session outcomes. Native BTC v4 and equity v2 publications succeed and
review the current research context. Missing verified earnings dates remain
explicit unknown event risk, with short-term abstention rather than fabricated
calendar coverage. No percentage is represented as demonstrated accuracy.

The actual MSTR main view displays a short-term abstention, conditional medium
and long directions, a concise pending-validation line, reviewed research
feedback and closed detail panels. Demo evidence/condition interactions and
390px layout pass without horizontal overflow; desktop viewport is restored,
temporary demo tab/server are removed, and the production background monitor
remains enabled for all three assets at its existing 15-minute interval.
The real dashboard proof is saved outside Git in the local acceptance directory.

Integrity checks preserve all 3,719 pre-existing immutable public market/research
record fingerprints and all three unrelated owner-file byte fingerprints.
The 64 intended delivery files pass whitespace and secret-material checks;
owner edits are excluded from the staged tree. Delivery uses only the owned
repository feature branch, with a checked expected-head lease. Existing
schedulers keep collecting subsequent completed market windows; this is a
prospective experiment, with no automatic weight promotion or regrading.

## Verified equity earnings follow-up (2026-10-15)

Owner request: verify TSLA/MSTR earnings, repair missing event input and repeat
real readonly acceptance. Preserve all historical forecasts and three unrelated
owner edits. Continue only on the owned feature branch.

UI choice: one short verified earnings date/timing line in the existing combined
assessment; source link and verification time remain inside its existing closed
details. No new panel, settings flow or navigation. The line wraps on narrow
screens, source is a standard keyboard-accessible link, and the shared disclosure
continues to own interaction. Unknown/expired dates remain explicitly unknown;
verified near-term earnings can still require abstention.

- [x] Add strict keyless official announcement discovery/parsing and bounded
  refresh; separate confirmed dates from generic calendar estimates.
- [x] Preserve provenance from an independently reviewed official page when
  automated access is restricted, using an append-only local public-event store.
- [x] Keep source health, caches, current judgment and native evidence independent
  of unrelated news/SEC failures; preserve exact legacy replay.
- [x] Verify dates, real scans and native research, types, targeted/full tests,
  browser/demo and immutable-record integrity; prepare owned-branch delivery.

Initial investigation confirms official TSLA 2026-10-21 after-close and MSTR
2026-10-29 after-close. Web and browser can read both official announcements.
Actual Node fetch reaches Strategy press listing/article, while Tesla IR returns
403. Never turn HTTP rejection into a claim that no event was announced.

Real acceptance: TSLA source is a current independently reviewed official
announcement (original verification 2026-10-16T05:49:46.929Z), while direct
Tesla IR requests still receive HTTP 403. The reviewed evidence has a strict
24-hour lifetime, never renewed on a failed refresh. MSTR is read directly
from its official directory and announcement. No report dates are hardcoded
into production code or silently inferred from a webcast time.

Both real stock scans complete successfully. TSLA now reports a verified
2026-10-21 after-close event and short-term `earnings-near` abstention, rather
than unknown calendar risk. MSTR reports 2026-10-29 after close, removes only
the unknown-calendar restriction and retains a conditional bullish price bias.
Both new archives replay as verified. Both native equity-v2 publications
complete, include the correct linked earnings observation, match the newly
scanned snapshot and review the current three-contributor research context.
Their qualitative short-term outlooks may still remain uncertain for other
evidence reasons. Original daily Jev v4 publications remain immutable and
valid; fixing an input never rewrites a prior prediction.

The actual TSLA/MSTR browser views and demo contracts pass the date-line/source
disclosure interaction. A 390px demo viewport has no horizontal overflow; the
viewport is restored and the temporary demo tab/server are removed. The main
explanation does not repeat the same event-risk sentence in its warning list.
The production platform remains in detached readonly mode at the existing
15-minute cadence with all three assets enabled and no current scan error.

Final integrity review preserves 3,743 existing immutable public market/research
records and all three unrelated owner-file byte fingerprints. Related staged
source excludes those owner edits. A full regression is rerun on frozen source
after the final UI risk-deduplication adjustment; final results follow below.

Final frozen-source regression: 886 files, 7,951 passing tests, four existing
skipped, zero failures (387.42 seconds). All 26 changed production/spec source
fingerprints match the pre-run freeze. Root, UI and opentypebb typechecks exit
0. The final UI owner closure passes 54 tests; the final panel-specific check
passes all six. Reader 41 and reviewed-store 34 targeted cases also pass.
No local event-state files or raw credentials are included in Git; only
implementation, synthetic fixtures/tests and subsystem documentation ship.
Owned origin and local base both equal b2b4eacf before the checked-head update.
