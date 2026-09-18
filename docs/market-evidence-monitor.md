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

SEC automated requests use an operator-declared contact email, loaded only from
`<OPENALICE_HOME>/data/market-monitor/sec-contact.json` (`contactEmail` string).
The owner supplies a real monitored address and authorizes its transmission to
SEC in the User-Agent. Keep this local file private (mode 0600); never commit
it or place its contents in public settings, receipts, archives or diagnostics.
No SEC account or API key is required. Missing or invalid configuration fails
locally with an actionable source-health message instead of sending an
undeclared request. Configuration is re-read on each source load, and a contact
correction clears the previous declaration cooldown.

`sec-edgar.ts` owns that request policy and filing validation. Both equity
sources share a request-start queue capped at one request per second, and
concurrent reads for the same company share one request. HTTP 403 pauses SEC
access for at least 15 minutes; other HTTP failures pause it for at least one
minute. A longer Retry-After is honored. Requests time out after ten seconds,
and redirects are rejected so the contact is sent only to the configured SEC
host. Error bodies and raw transport messages are not persisted. HTTP 200 is
healthy only with valid filing columns and a matching company identity when
provided. A valid empty filing list is distinct from malformed data.

An undeclared-tool 403 identifies SEC's automated-access rejection; it does not
prove that changing the declaration alone will remove a network-address block.
If SEC still denies a correctly declared request, preserve the diagnostic and
cooldown and follow SEC support guidance rather than spoofing a browser or
rotating addresses. Official policy: [Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data).

## Analysis timing, scores and context units

Strategy manifest version 2 preserves the existing strategy ID and adds optional
`analysisBasis` metadata to new observations. Old records remain readable and
are labelled unverified for close status; stored history is never rewritten.
Only completed candles enter analysis. BTC daily boundaries are UTC; equities
use the New York session date with a conservative 16:15 cutoff (regular close
plus vendor lag). Hourly candles need a complete elapsed hour. Weekly
follow-through excludes the current Monday–Sunday calendar week. Live charts
may include a forming candle and carry their own timestamp; the analysis price
is explicitly the completed daily close. Date-only session identifiers are
rendered without timezone conversion. Hour and four-hour changes require
continuous hourly samples, so an overnight/weekend gap is not a four-hour move.

Freshness is checked against actual usable candles before source acceptance.
BTC daily/hourly maxima are 48/3 elapsed hours, including weekends. Equity
hourly data must be within three hours during the regular session after 10:30
New York; otherwise a four-calendar-day tolerance allows weekends and a
holiday. This is a conservative policy, not a complete exchange holiday or
early-close calendar. A stale source triggers the same explicit fallback and
combined-error path as a failed request. An hourly failure still permits a
clearly marked daily-only assessment.

All confidence fields remain wire-compatible numbers but are displayed as
rule scores out of 100, not probabilities. Event-test confirmation is local to
the event and never confirms the future direction of a phase. LPS/LPSY require
a quieter retest and a subsequent completed close beyond the test extreme;
missing volume cannot count as quieter. A later boundary violation invalidates
the original event. Historical evaluation is labelled adjacent-observation
agreement, not a backtest; unchanged daily identities, flat prices and analysis-version transitions do not
count as resolved directional trials. Fixed forward horizons are not yet
implemented.

Deribit `funding_8h` and equity short-float ratios are fractions and become
percentages at display time. Instantaneous funding is not substituted for an
8-hour value. Annualized basis already uses percent units. BTC perpetual open
interest is USD; BTC option open interest is BTC. JSON-RPC errors, empty market
responses and missing required instruments are unavailable even with HTTP 200;
partial failures retain their individual causes.

Successful context observations are saved atomically in a per-asset/strategy
`context-*.json` cache on every completed scan, including semantic duplicates.
This additive cache contains only public fields and survives restart; old
observations and input archives are not rewritten or used to invent a newer
source time. A failed source may borrow only its own failed fields from the
same provider. BTC display grace is 30 minutes, allowing a normal 15-minute
scan plus request/poll time; equities retain a 24-hour maximum. The original
source time and fixed expiry remain visible next to the values, explicitly for
reference only. The source remains unavailable/degraded and contributes the
same data-quality warning to the brief. Repeated failures never renew the cache.
Successful empty results do not resurrect old news, filings or calendar fields.

Deribit and equity context reads retry transient timeout/network/HTTP 5xx
failures at most once, after 250ms, with a 12.5-second total waiting budget.
Deribit aborts each HTTP attempt after six seconds. Uncancellable equity reads
remain tracked until settlement so later scans cannot launch overlapping copies
or accept their late results as fresh. HTTP 401/403/429 and invalid responses
are not retried. SEC keeps its separate declaration, pacing and cooldown policy.
Equity diagnostics identify the failed subrequest (metrics, estimates, share
statistics, calendar or news), classify HTTP/timeout/network errors, and never
persist raw request messages. Partial failures are degraded even when another
fundamental field exists; failed news/calendar reads are distinct from valid
empty results. No source credentials or private configuration enter the cache,
receipts or archives.

Detached first-run startup never sends an admin token to redirected stdout or
the background log. The existing one-time credential display remains available
only on an interactive terminal; this change does not rotate existing tokens.

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

## Historical input replay and narration identity

New observations reference a SHA-256 digest and strategy version. Their
`inputs/<snapshot-uuid>.json.gz` sidecars contain schema version 1, the complete
closed-bar inputs, analysis time, alert-independent analysis thresholds,
strategy identity/version, public context, source health and the recorded
snapshot with historical closed-bar chart data. No credentials, authenticated
request headers or raw provider response objects enter these archives.

The archive is published atomically without overwrite before its observation
journal entry. Duplicate scans reuse the canonical saved identity and do not
create another archive. A crash between archive and journal append may leave
an unreferenced archive; no automatic destructive cleanup is performed. Files
are compressed and retained with the complete data home. They are not a cache.
Earlier records are not rewritten or backfilled from current provider data.

`GET /api/market-monitor/snapshots/:id/replay` reads one UUID directly, independent
of the bounded recent-history journal view. It never fetches market data,
changes settings or launches Codex. It recomputes the registered strategy using
the archived time/parameters and compares every deterministic output and the
semantic fingerprint. Responses distinguish `verified`, `mismatch`,
`unavailable` and `unsupported`. Corrupt or mismatched archives fail with HTTP
422. Strategy behavior changes must advance the manifest version; unavailable
older implementations cannot claim a successful same-version replay. A digest
checks accidental input corruption; it is not a signature against someone able
to rewrite the complete local home.

The history table offers Replay check and an explicit input/result export.
Results show original time, version, completed-bar counts and source attribution.
The latest live chart may contain a forming candle; replay exports always use
the original completed candles. Successful replay proves reproducibility, not
forecast accuracy. Fixed-horizon outcome evaluation remains future work.

`market_monitor_daily_input` returns `snapshotId` and `inputHash` per asset;
`market_monitor_publish_narration` requires both unchanged. The writer validates
the archived asset, strategy and daily period before accepting prose and stores
its exact basis and strategy version under `codex-daily-v2`. Evidence may move
while Codex writes: that prose retains its original basis, and the dashboard
labels it stale when displayed alongside a later observation. Legacy prose
without a basis is unverified. Only the exact historical input row (and the
latest row with an explicit relationship label) receives that narration.
The one-publication-per-asset/strategy/day budget and authorized Issue checks
remain unchanged; stale prose does not automatically dispatch a new model run.

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
- Historical per-provider healthy/degraded/unavailable check counts and observed recoveries,
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
and each provider's degraded/unavailable episodes. It distinguishes periodic `scheduled` receipts from `narration` receipts created
by the daily interpretation. After two configured intervals it checks for a
missing periodic scan. Every probe also checks completion age and scan start
time: a dispatch more than two minutes late or a scan pending longer than two
minutes fails acceptance. New receipt sequences reveal dispatch gaps even when
an outage recovered between probes. Summaries expose per-asset completed counts,
narration counts, longest idle gap and last completion. The scheduler exposes
`scanStartedAt` and an actionable warning on the dashboard without starting a
second scan or cancelling a read. Historical pre-change `scheduled` receipts
cannot retrospectively distinguish daily interpretation triggers.

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

The long-run observer derives current scan/source incidents from the latest
completed receipt, including scheduler receipts newer than the report read.
It does not treat historical per-provider aggregates as current outages. A
healthy replacement provider closes an earlier fallback incident. A new failed
scan remains current across repeated probes; missing source telemetry or a
partial scan cannot establish recovery for sources it never reached. Historical
failed attempts remain in the acceptance report even after recovery.
