# Market Evidence Monitor

This guide owns the read-only BTC/TSLA/MSTR evidence monitor, its persistence and
the `/market/evidence` dashboard. Market-data provider selection and candle
semantics remain owned by [[docs/market-data-architecture.md]].

## Product Boundary

The monitor organizes observable market evidence. It is not an execution
strategy and never accesses accounts, approvals, credentials or order writes.
Its initial asset registry contains:

| Asset | Bar symbol | Context |
|---|---|---|
| BTC | `BTC-USD` | Coinbase preferred spot bars; Deribit public funding, perpetual/futures and options summaries |
| TSLA | `TSLA` | Alpaca IEX preferred bars; OpenAlice equity/reference/news and SEC EDGAR context |
| MSTR | `MSTR` | Alpaca IEX preferred bars; OpenAlice equity/reference/news and SEC EDGAR context |

Daily and hourly candles are separate attributed requests through BarService.
If the hourly source fails, the UI reports it as unavailable; daily candles are
never relabelled as intraday data.

BTC prefers the read-only `coinbase|BTC-USD` spot source and falls back
explicitly to `yfinance|BTC-USD` when Coinbase is unavailable. Coinbase public
spot candles require no key. Optional CDP ECDSA credentials enable its
authenticated read-only endpoint without adding account or order access to the
monitor. Empty or insufficient usable bars also trigger fallback (minimum 20
daily bars, two hourly bars), including rows excluded by quality checks. If both
sources fail, both provider reasons remain visible. A daily failure stops the
scan; an hourly failure preserves daily analysis and marks intraday unavailable.

TSLA and MSTR prefer the read-only `alpaca|SYMBOL` Market Data provider. If its
two credentials are absent, rejected or temporarily unavailable, each request
falls back explicitly to `yfinance|SYMBOL`; source health records the attempted
source, selected fallback and reason. This is independent from the money-capable
Alpaca UTA and remains available in the monitor's default Lite launch.

SEC EDGAR is a separate keyless context module. It reads each company's official
submissions feed with an identifying User-Agent and retains the latest material
10-K, 10-Q and 8-K family filings as linked evidence. A SEC outage does not
discard Alpaca/Yahoo bars or other successful context modules.

## Modules

- `src/domain/market-monitor/analysis.ts` owns the first strategy
  (`evidence-chain-v1`), semantic fingerprints and observation evaluation.
- `src/domain/market-monitor/trend.ts` owns deterministic short-, medium- and
  long-horizon direction/regime assessments. Horizon disagreement remains an
  explicit mixed state instead of being averaged into one direction.
- `src/domain/market-monitor/wyckoff.ts` owns the candidate-based Wyckoff
  reading: trading range, phase candidate, Spring/upthrust/UTAD/SOS/SOW/LPS/
  LPSY events, test state, supporting/opposing evidence and explicit
  confirmation/invalidation conditions.
- `src/domain/market-monitor/daily-brief.ts` composes the structured daily
  brief. Its logical identity is asset + strategy + latest attributed daily
  candle date; it remains available without an Agent CLI or model connection.
- `src/domain/market-monitor/strategy.ts` owns the strategy contract and
  registry. A strategy declares a stable ID, version, required inputs, analysis
  function and semantic fingerprint function.
- `src/domain/market-monitor/context.ts` owns composable asset-context
  providers. Multiple providers may support the same asset; one provider
  failure becomes a source-health row without discarding successful modules.
- `src/domain/market-monitor/service.ts` owns source orchestration, explicit
  fallback health, snapshot de-duplication, alert conditions and one in-flight
  scan per asset (shared by scheduled and manual callers).
- `src/domain/market-monitor/scheduler.ts` owns background cadence. WebPlugin
  creates one service shared with HTTP/IPC, starts the poller only after the
  listener is ready (or on IPC startup), and stops it during shutdown.
- `src/domain/market-monitor/store.ts` owns append-only JSONL observations,
  alerts and scan receipts plus atomic settings writes under
  `data/market-monitor/`.
- `src/domain/market-monitor/journal.ts` reads recent records backwards in
  64 KiB blocks, preserving multi-byte text and skipping incomplete rows.
- `src/domain/market-monitor/health.ts` summarizes recorded attempts and source
  checks into bounded operational reports; it owns no trading evaluation.
- `src/webui/routes/market-monitor.ts` exposes the read-only scan/history API
  and validated settings updates.
- `ui/src/pages/MarketEvidenceMonitorPage.tsx` owns the responsive dashboard,
  1D/1H switch, export and opt-in browser alerts. The status hook at
  `ui/src/hooks/useMarketMonitorStatus.ts` reads backend state; no browser
  timer owns market scans.
- `ui/src/hooks/useMarketMonitorHealth.ts` reads the selected asset/window;
  `ui/src/components/market/MonitorOperations.tsx` presents and exports it.

Adding another strategy now means implementing `MarketMonitorStrategy` and
registering it. It automatically appears in `GET /api/market-monitor/strategies`
and the dashboard settings selector; HTTP routes and React do not need new
decision rules. A new context source implements `MarketContextProvider` and may
be composed with existing providers for BTC, TSLA, MSTR or a future asset.

## Localization

The dashboard and its Market navigator entry follow OpenAlice's one global
locale; the monitor does not own a second language switch. UI chrome, settings,
runtime status, operational reports, evidence, hypotheses and confirmation /
invalidation conditions use the typed i18next catalog. Number and date display
uses the same global Intl locale.

Persisted observations remain language-neutral inputs for presentation. Known
strategy evidence and hypothesis IDs are rendered from their structured values,
so observations recorded before localization switch immediately with the UI and
do not require deletion or another scan. Unknown future strategy IDs retain
their stored text until that strategy provides presentation copy. Provider
names, exported JSON/CSV fields and external news headlines remain original
evidence rather than being machine-translated.

## Runtime Behaviour

The page loads histories for all registered assets and source settings, and refreshes
the view while visible. Hidden pages pause view polling and reload on return;
they do not stop the backend. A refresh error keeps the last successful render
visible but labels the connection as unavailable rather than claiming it is
currently active. Empty histories require an explicit **Scan now** or enabling
background monitoring; opening multiple pages does not dispatch extra scans.

**Monitor settings → Background monitoring** is off by default. Enable it,
select BTC, TSLA and/or MSTR, and save a cadence of 1–1440 minutes (default 15).
The backend checks configuration every 15 seconds, including while the page is
closed. Settings changes take effect on the next check. Pause prevents new
dispatch; an active read finishes. The machine must remain awake with the
OpenAlice backend running. This is not an OS daemon or a claim of 24/7 uptime.

`GET /api/market-monitor/status` returns the scheduler lifecycle, last check,
errors, per-asset enabled/in-flight state, latest receipt and next due time.
The due time is not a market-data timestamp and execution may begin up to one
poll interval later. Source health remains the authority for data availability.

Completion receipts anchor cadence across restart, including manual scans and
failed attempts. Older receipts use their request time. Missed intervals are
collapsed into one scan, never replayed as a burst. One failed asset does not
stop the others. A pending scan for one asset does not block dispatches for the
other assets: the short polling lock is separate from per-asset scan lifetime.
If a scan cannot persist its failure receipt, runtime status retains its error
in memory until a later attempt succeeds or supersedes it. Requests overlapping
on one asset share one result and one
receipt, with the initiating request's trigger retained. This exclusion is
within one backend, not a distributed lock between multiple independent
backends writing the same state directory.

Every scan writes a receipt labelled `manual` or `scheduled`. A snapshot is
written only when its semantic fingerprint changes; cache-hit text, fetch time
and other transport mechanics do not create a new observation. Continuously
moving derivatives values are bucketed at decision scale, so insignificant
last-decimal changes do not create observation noise while meaningful funding,
positioning or basis changes remain visible. If a context provider becomes
temporarily unavailable, the last valid values remain visible while source
health clearly marks them as retained and unavailable/degraded. Alerts are
deduplicated by asset, evidence state and latest attributed candle.

Settings persist the active strategy ID. Observation histories, latest chart
series and evaluation results remain separated by asset and strategy, so
switching algorithms never mixes their evidence or accuracy records. Existing
pre-registry settings and default-strategy chart files remain readable.

Browser notifications are opt-in and work only while the dashboard is open.
Recorded alerts survive closing the page; native/background push delivery is
intentionally outside this increment. No trading or agent-execution endpoint
is used by the scheduler.

## Trend, Wyckoff and daily briefs

Each new scan evaluates three independent horizons:

| Horizon | Primary evidence | Intended reading |
|---|---|---|
| Short | 1h/4h pulse, 1d/5d momentum, five-day structure | Immediate momentum and transition |
| Medium | 20-day structure/slope, 60-day location, weekly follow-through, volume/result | Swing trend versus trading range |
| Long | 50/200-day relationship, 200-day slope, 120-day return, annual range | Secular backdrop |

The Wyckoff module is a complete analysis contract, not a promise of perfect
real-time pattern recognition. It reports a phase **candidate**, caps confidence
at 85%, preserves contradictory evidence and requires a later test before an
event becomes confirmed. “Accumulation” and “distribution” therefore describe
testable price/volume hypotheses; they do not claim knowledge of a coordinated
market actor.

The dashboard creates one logical brief for each attributed daily-candle date.
BTC advances when its next daily candle arrives; TSLA and MSTR advance on their
next trading-day candle, so weekends and market holidays do not produce empty
briefs. Intraday scans may refresh the live evidence under the same date. The
deterministic narrator remains the authoritative bilingual record. A
supplemental native-Codex interpretation is enabled by default and runs from an
OpenAlice scheduled Issue at 17:30 `America/Vancouver` (`catchUp: true`). One
Issue handles BTC, TSLA and MSTR: BTC can advance every day, while equities are
skipped until a new attributed trading-day candle exists. The dashboard also exposes an
explicit **Run Codex** action for immediate verification.

The scheduled Issue uses the existing native Codex login and inherits its model
unless the Issue is edited later. It refreshes read-only evidence through a
Workspace tool, publishes at most one narration per
`asset + strategy + daily-period`, and sends a concise Inbox summary. The write
tool accepts output only from that exact Issue running as `codex`; ordinary Chat
sessions, other agents and other Issues cannot publish. Narrations are
append-only and carry Workspace, Issue, run, agent, model and effort provenance.
They supplement but never replace deterministic scores, phases, confirmation
conditions or invalidation conditions. This keeps model use and failure history
visible without adding an in-process model client or any trading authority.

Manual **Scan now** and **Run Codex** actions expose their lifecycle directly
below the page header. A scan keeps its selected asset visible while market data
is fetched, then distinguishes a newly stored observation from a successful
check with no material evidence change. Run Codex remains busy after dispatch
and polls the exact headless task id until it finishes; only then does the page
reload the latest BTC/TSLA/MSTR narrations and announce completion. Failures remain
visible with retry and dismiss actions. Status regions are announced to assistive
technology, and progress animation honors reduced-motion preferences.

## Fork branding

The web shell is branded `MAD42Lab` in the browser title, desktop activity rail,
mobile header and empty workspace. Internal package scopes, HTTP headers, data
directories, CLI commands and the upstream About/update attribution keep their
OpenAlice names. That split makes the product visibly ours without breaking the
base platform's compatibility or making future upstream merges needlessly hard.

## Operational Reports

The dashboard's **Monitor operations** section follows the selected asset and
offers **24 hours**, **72 hours**, refresh and **Export report** (JSON). It is
available even when no valid market snapshot exists, so failed attempts remain
inspectable. Reports refresh every 30 seconds while visible, after a manual
scan, and when the observed latest receipt changes. Selection changes clear
the prior report; a refresh failure explicitly labels retained facts.

`GET /api/market-monitor/health?asset=BTC&hours=24` returns schema version 1:

- Requested window and actual first/last recorded sample, with a 5,000-attempt
  cap and a `truncated` flag if earlier samples in the window were excluded.
- Successful, failed, new-evidence and unchanged-evidence attempts; scheduled
  versus manual counts; consecutive failures and observed scan recoveries.
- Average and 95th-percentile scan duration, with the number of measurements.
- Per-provider healthy/degraded/unavailable check counts and observed recoveries,
  plus the latest check time and underlying market-data time.
- The latest 12 attempts, including errors and strategy identity when known.

Receipts include optional duration, strategy and source checks with diagnostic
details, including for unchanged evidence and failed bar acquisition. Failed
scans also carry `failureStage` (configuration, daily-bars, analysis, context or
storage). Source checks collected before a later failure are retained; dual
provider failures retain both causes. The dashboard displays actual providers,
fallback reasons and failure stages in source health and recent attempts. Older
receipts remain readable but missing telemetry is unknown, not healthy. Source
recoveries require adjacent observed checks for the
same provider; an unknown gap does not establish recovery. Operational reports
include all strategies; strategy performance evaluation remains separate.

Completion rate is the fraction of recorded attempts that finished successfully.
It does not measure continuous uptime, identify missed dispatches while the
backend was stopped, prove source completeness or establish trading returns.
A 72-hour selection with only a few minutes of samples is still a short sample.
Active scans and failures that could not be written to disk are visible through
runtime status, not counted as completed historical attempts.

Recent journal reads stop after collecting the requested matching records.
They avoid loading the whole archive on normal status polls; sparse or absent
asset matches may still require scanning the full file. Memory depends on the
returned records and longest individual line. Archives remain append-only;
this increment adds no destructive retention or compaction.

## Preview and Verification

### Mac one-click source launch

On the maintained feature branch, double-click
`scripts/market-monitor-mac.command` in Finder. The command adds the usual
Homebrew locations to `PATH`, installs workspace dependencies on first use,
checks macOS, Node.js 22.19+, pnpm, Git and the current branch, then builds the
UI's internal `@traderalice/connector-protocol` workspace dependency before it
starts the real OpenAlice source stack in read-only Lite mode. The default
launch is detached from Terminal: it writes output to
`~/.openalice/state/market-monitor.log`, waits for Guardian's actual Vite port
and the OpenAlice application shell, opens `/market/evidence`, and then exits
the launching shell without stopping OpenAlice.

Finder also has separate lifecycle entry points:

- `scripts/market-monitor-open.command` reopens the running dashboard.
- `scripts/market-monitor-stop.command` gracefully stops the background stack.

The same entry point is available in Terminal:

```bash
pnpm market-monitor:mac
pnpm market-monitor:status
pnpm market-monitor:open
pnpm market-monitor:stop
pnpm market-monitor:mac -- --check
pnpm market-monitor:mac -- --demo
pnpm market-monitor:mac -- --foreground
```

`--check` performs no startup. `--demo` opens deterministic fixtures and remains
foreground-only. `--foreground` retains the original Terminal-attached real
stack for debugging. `--full` starts the normal optional trading services,
while the default skips them because the monitor only needs read-only market
providers. `--no-open` leaves the browser closed, and `--home=<directory>`
passes an isolated data root to Guardian.

The background launcher reuses an already-running detached instance rather
than starting a duplicate. Status, open and stop resolve the same data home and
Guardian control socket. Stop is accepted only when the runtime identifies
itself as a detached `dev` owner launched from this checkout; a foreground,
packaged or differently sourced OpenAlice is never killed by the helper. The
launcher does not switch branches, take over an existing runtime or edit
monitor settings. Stop an explicitly foreground source stack with Control-C.
`pnpm market-monitor:status` prints the exact log path; follow it with
`tail -f ~/.openalice/state/market-monitor.log` when startup diagnostics are
needed.

Both plain `pnpm dev` and the deterministic monitor preview run the same
workspace-package preparation automatically. This matters on a new clone:
`pnpm install` links local packages but does not create
`packages/connector-protocol/dist/index.js`, while Vite resolves that package's
normal import entry to `dist`.

An older checkout already showing Vite's “Failed to resolve entry for package
`@traderalice/connector-protocol`” overlay can be repaired once with:

```bash
pnpm --filter @traderalice/connector-protocol build
```

Refresh the page afterward, or stop the old foreground stack with Control-C,
pull the feature branch and start it again. Updated launch commands perform
this step automatically and use background mode by default.

For the first checkout from our repository:

```bash
git clone https://github.com/MAD42CAP/OpenAlice.git
cd OpenAlice
git switch feature/market-evidence-monitor
pnpm install
pnpm market-monitor:mac
```

From the repository root:

```bash
pnpm market-monitor:preview
```

This builds deterministic demo data, starts the local web UI and opens
`/market/evidence`. The amber `DEMO DATA · NOT LIVE` label distinguishes it
from the real runtime. For a non-serving build check:

```bash
pnpm market-monitor:preview -- --check
```

For real configured providers, run `pnpm dev`, choose **Market → Evidence
Monitor**, and inspect every source-health row before using an interpretation.
In a second terminal, the default acceptance command only checks the live page
and read APIs:

```bash
pnpm market-monitor:acceptance
```

To exercise real scans for both assets and verify receipts, chart restoration,
source attribution and semantic de-duplication consistency:

```bash
pnpm market-monitor:acceptance -- --scan
```

Every acceptance report includes the selected assets' 24-hour operational
reports. `--scan` also verifies its new attempts contain duration and source
checks in that report. A short smoke pass does not satisfy 24–72-hour observation.

To verify browser-free scheduling on an otherwise paused monitor:

```bash
pnpm market-monitor:acceptance -- --background
```

This explicit mode temporarily enables a one-minute schedule for the selected
assets and waits up to 150 seconds for backend-created scheduled receipts. It
does not call the scan endpoint. It restores the original settings in a
`finally` block on success or failure, unless another operator edited them
during the run (those newer settings are preserved and the command fails with
an explanation). Do not edit settings concurrently. If the acceptance process
is forcibly killed, check the background switch manually. An already-enabled
monitor is rejected rather than interrupted. `--asset=TSLA`, `--asset=MSTR` or
`--asset=BTC` can narrow the test.

The command accepts `--base-url=http://127.0.0.1:<port>` when Guardian selected
a non-default port, and writes `dist/market-monitor-acceptance.json`. Non-local
URLs are rejected unless the caller explicitly adds `--allow-remote`.

For a sustained observation after enabling background monitoring in the
dashboard:

```bash
pnpm market-monitor:observe -- --duration=24h
pnpm market-monitor:observe -- --duration=72h
```

The observer is read-only: it does not enable the monitor, edit cadence or call
the scan endpoint. Once per minute it reads runtime status and the 72-hour
health reports, saving an atomic checkpoint to
`dist/market-monitor-observation.json`. `--asset=BTC`, `--asset=TSLA` or
`--asset=MSTR` narrows the scope; `--sample-seconds=15` through `3600` changes
probe frequency.

The final report distinguishes local API reachability, scheduler heartbeat and
configuration interruptions, newly observed scheduled receipts, scan failures,
and each provider's degraded/unavailable episodes. It checks for missing
cadence after at least two configured intervals.

`pass` means the observer reached the backend, found no operational or source
incidents and saw cadence when the duration was long enough. `attention` keeps
transient API, scan or source episodes visible. `fail` covers stopped/stale or
disabled scheduling, less than 95% API reachability, or missing expected
cadence. Interrupting the command leaves an `incomplete` checkpoint rather than
claiming acceptance. An API outage never counts as evidence that an earlier
incident recovered.

Mac/Electron acceptance must confirm desktop and narrow-window layout, live
timestamps, the 1D/1H switch, persistence after restart and no duplicate scan
records across a 24–72 hour observation window.

## Repository Scope

Development is retained in `MAD42CAP/OpenAlice` on
`feature/market-evidence-monitor`. The former upstream PR #1494 is closed and
unmerged. No upstream PR, release or third-party-team deployment is part of
this workflow. Preview/build commands above are local.
