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
count as resolved directional trials. The separate historical review described
below uses explicit forward daily/session windows and archived original inputs.

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

## Historical outcome review and feedback

`GET /api/market-monitor/review?asset=BTC&days=30` accepts BTC/TSLA/MSTR and
7/30/90 calendar-day lookbacks. It is a bounded, read-only local projection:
no provider request, scan, model run, settings mutation or order is dispatched.
It uses archived original judgments and the latest saved daily series. The
separate input-replay endpoint still checks reproducibility; review checks
subsequent outcomes and never runs the current strategy on future inputs to
rewrite historical predictions.

Protocol `forward-sessions-v1` was fixed before inspecting live outcome scores:

- One rule observation per publication session date **and strategy version**,
  always the first recorded. BTC dates use UTC; equities use New York time.
  AI interpretations form a separate cohort anchored to `generatedAt`, never
  backdated to an earlier underlying snapshot. Their basis digest, version and
  fingerprint must match the immutable archive.
- Entry is the first daily open after the publication's session date. The
  remainder of publication day is deliberately excluded. Windows are 1/7/30
  completed BTC candles and 1/5/20 observed equity sessions, paired with
  short/medium/long trends. These are descriptive review horizons, not an
  assertion that earlier prose promised exactly these durations or a price
  target. In particular a month is only a consistency check on the long-term
  backdrop, not proof of a secular forecast.
- Directional bullish/bearish cases receive supported/opposed/flat outcomes.
  Absolute changes at or below 0.25% are flat, retained in the directional
  denominator and never credited as supported. Sideways/transition/insufficient
  judgments have no directional score. Summaries separate versions, pending
  cases, excluded data and non-directional cases. The always-bullish comparison
  uses the identical directional cohort. Rates describe overlapping samples,
  not independent trials, calibrated probabilities or executable returns.
- Outcomes retain opening/closing prices, exact dates, high/low excursions,
  original/outcome providers and closes above/below/inside the original
  Wyckoff range. Range observations do not automatically confirm or invalidate
  an entire phase. Original event statuses, opposing evidence and free-form
  confirmation/invalidation conditions remain visible for inspection.
- Missing/unverifiable archives never enter scored outcomes. Forming bars are
  excluded. Missing left coverage, duplicate dates, invalid OHLC, BTC day gaps,
  equity gaps over four calendar days and ambiguous missing equity weekdays
  are excluded. Without the full exchange calendar a holiday cannot be
  distinguished reliably from a feed hole; exclusion is conservative.
- Up to 20,000 asset observations and 1,000 narrations are read for review. The
  public snapshot-history endpoint remains capped at 1,000. Reaching either
  review cap is explicit, and a potentially partial earliest rule day is
  omitted. Past forecasts are not backfilled. Provider revisions may change
  the current outcome series; JSON export preserves this report's prices,
  protocol, timestamp, original reasoning and identities.

The dashboard offers lookback, original record type/date and horizon selectors,
a price path with exact daily prices, versioned descriptive summaries and
traceable findings. Demo outcomes are explicitly synthetic. Missing archives,
uncompleted horizons and original prose receive distinct states. A prose
interpretation has no automatic hit rate: it did not register a structured
forecast contract at publication, so inferring one afterward would invite
hindsight bias.

Native `market_monitor_daily_input` now includes compact retrospective feedback:
summary counts, identified cases, their original reasoning/conditions and
observed outcomes. The tool description tells the daily Codex agent to consider
previous misses, horizon disagreement and path risk while avoiding retrospective
rule fitting. Feedback read failure is explicit and does not block a current
brief. There is no extra model scheduler or automatic live threshold update.
Judgment-rule changes require a separate version and untouched future
validation observations; a small retrospective sample cannot establish an
improvement. Structured prose forecasts and full exchange-calendar support
remain distinct follow-up capabilities.

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

## Research charts and issuer context

`GET /api/market-monitor/research?asset=BTC|TSLA|MSTR&days=30|90|365`
returns attributed chart modules without running a scan or changing a strategy.
The original `/dashboard` route remains an alias. Chrome on the owner's Mac
blocked that URL with `ERR_BLOCKED_BY_CLIENT` despite HTTP 200 from the backend
and Vite proxy. The research client uses the descriptive `/research` route;
no browser protection is disabled. Failed refreshes retain the prior chart with
a warning, retry at 5/15/30 seconds, and stop when the view is hidden. Switching
assets/windows clears the previous selection immediately.
`dashboard.ts` joins closed stored bars, original judgment/event dates and public
context observations. It separates the time an event occurred from the time its
state was first recorded. Source data, publication, acquisition and assembly
timestamps are distinct; absent publication dates stay unknown. The UI hooks
keep old asset/window responses from replacing a newer selection.

New `research-<asset>.jsonl` journals are additive public-data records. Every BTC
scan records derivatives, including semantic duplicates. Retained failed-source
values remain labelled stale and are excluded from fresh historical points.
Older observations can contribute only their originally recorded data. Research
metrics are captured at acquisition time; a newly retrieved issuer report never
becomes an input to an old prediction. Reads are bounded to 2,000 judgments and
20,000 scalar observations and disclose a reached bound. Different providers
and formula versions remain separate series. Per-asset writes serialize cached
research deduplication. Existing immutable inputs are never rewritten.

The existing opt-in backend scheduler collects supplementary research after a
successful scan. Public-source failures remain visible inside the research
report and never turn a successful price scan into a failed price receipt.
No second scheduler, account access or trading writes are introduced.

`btc-dashboard.ts` uses existing Coinbase/Yahoo BarService fallback for a long
closed daily history. Its 200-week simple average requires 200 consecutive,
complete UTC Monday–Sunday weeks. The 2024-04-20 anchored average uses daily
typical price and a single provider's volume; missing days/volume make it
unavailable. It is not transaction VWAP or a global holder cost basis.
Alternative.me provides attributed historical Fear & Greed daily values.
Coin Metrics Community supplies `CapMVRVCur`; attribution and its CC BY-NC 4.0
terms are displayed. Commercial reuse requires appropriate data rights.
Hashrate, mining difficulty and mining cost models are explicitly out of scope.

`strategy-dashboard.ts` reads the issuer's public `bitcoinKpis`, `mstrKpiData`
and `strcKpiData` endpoints. mNAV retains the issuer's net-BPS definition effective
2026-07-23 and is not spliced with the old enterprise-value ratio. Rounded gross
BPS can imply only an explicitly labelled estimated assumed diluted sharecount.
Independent reporting dates absent from issuer fields remain unknown. USD Reserve
is unavailable when not provided; it is never added to potentially overlapping
cash. Annual interest/dividend coverage is the issuer's stated USD-assets model,
not a cash runway that includes all operations and maturing debt.

STRC has its own metrics, price and dividend-calendar charts within MSTR; it does
not enter the ordinary-stock Wyckoff scanner. The $100 line is a stated-amount
reference, not a redemption guarantee. No dividend-inclusive total return is
synthesized without complete ex-date/adjustment records. MSTR/BTC normalized
price curves use common calendar dates but explicitly disclose UTC versus New
York closes; they are not synchronous return correlations. Corporate funding
flows are not inferred from changes in price or total holdings.

Charts preserve gaps, draw irregular issuer observations as points and keep
different units on separate axes/charts. The weekly reference uses its own
sampling grid. Judgment actions open the existing original-input replay.
All new research is descriptive; production scores and historical rule inputs
are unchanged. A later rule change requires a new version and subsequent
untouched evaluation samples.

## Latest trade alongside closed-bar analysis

The page starts with an independent latest-trade panel and a link to research
charts. `GET /api/market-monitor/quote?asset=BTC|TSLA|MSTR` is a read-only request
backed by `src/domain/market-data/quotes.ts`. It neither dispatches a scan nor
writes quotes into historical analysis inputs. The response has `Cache-Control:
no-store`; only concurrent requests for the same asset are coalesced. Reloading,
manual refresh and returning to the visible page request a fresh quote. Visible
pages poll every 30 seconds; hidden browser tabs and hidden app views pause.

BTC uses the public [Coinbase Exchange last-trade endpoint](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker),
including its trade timestamp, without loading a private key. Stocks use the
configured read-only [Alpaca latest trade](https://docs.alpaca.markets/us/v1.4.2/reference/stocklatesttradesingle-1)
with `feed=iex`; IEX is not a consolidated US market quote. Both fall back to
Yahoo chart metadata's regular-market price/time, explicitly labelled possibly
delayed. Prices and timestamps must be finite, positive where applicable, and
not implausibly in the future. Provider failures are fixed reason codes; HTTP
bodies, credentials and raw network errors are never returned or logged.

Trade time and acquisition time are displayed separately. Old trades remain
marked stale even after successful refresh; a closed or quiet equity market
does not gain a fresh trade timestamp. Failed refreshes can retain the previous
price only with an explicit warning. This is a refreshed last-trade view, not a
WebSocket tick stream. Daily change, trend and Wyckoff evidence retain their
closed-bar basis and are not recomputed from the quote.

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

## Combined judgment and independent analyses

The dashboard leads with a current-evidence summary, followed by the existing
daily rule brief, independent Wyckoff analysis and Jev experiment. The summary
defaults to the weekly view; its buttons name 1/7/30 BTC days or 1/5/20 equity
sessions instead of relying on ambiguous short/medium/long labels. These are
interpretation horizons, not newly calibrated return predictions. The annual
rule trend supplies background to the monthly interpretation.

`judgment.ts` owns the language-neutral `evidence-summary-v1` composition.
Price/volume rules supply the initial bias. A matching confirmed Wyckoff event
can support it; an opposing confirmed structure withholds the direction as
unclear. Candidate or invalidated events cannot act as confirmed votes. Range
requires both a sideways rule assessment and a valid observed range containing
the analysis close. Price-derived methods are one evidence family: there is no
averaged confidence or additional independent vote for every indicator.

The summary verifies freshness against the snapshot's closed-bar basis, never
against a newer live chart candle. Missing/stale daily evidence blocks all
views; missing hourly evidence blocks the one-session view. Provider fallback,
partial/reference-only background data and a newer failed scan remain visible.
The conservative existing equity session/freshness policy still applies.
Upcoming calendar earnings near a view add an event-risk note, with
weekend/holiday slack and the actual scheduled date; no exact future exchange
calendar is inferred. Other
numeric context is labelled current or reference-only, conservatively requiring
all relevant context sources to be current (30 minutes BTC, 24 hours equity).
News headlines, SEC filing metadata, positioning levels and stale context are
not automatically interpreted as directional votes or as reviewed document text.

Jev remains independent and never overrides the headline. Its reference is
scoped to the same asset/strategy, rejects future/unverified records, and states
whether the observation is the same, different from today, or an older forecast.
No new model question, provider request, key read or paid generation is caused
by viewing this summary. The existing TypeSafe request contract is unchanged.

GET `/api/market-monitor/judgment?asset=BTC|TSLA|MSTR` reads the active strategy's
latest observation, receipts and verified local Jev report. Jev/report failure
does not remove a usable rule summary. This endpoint is no-store and sanitizes
read failures. `useMarketJudgment` owns selection, cancellation and visible-page
polling; a failed read replaces the headline with unavailable current evidence
while retaining prior details for reference. The presentation reuses Button and
Collapsible, wraps controls on narrow screens, and never conveys state by color
alone. The demo has an explicit illustrative endpoint and fixture.

These summaries are read-time projections with basis identity and check time.
They are not appended to the historical forecast journal and must not be counted
as original forward predictions. Existing rule/Jev archives and retrospective
records are unchanged; no historical forecasts are reconstructed or overwritten.

## TypeSafe/Jev research provider

Settings → AI Provider contains a separate TypeSafe market-research card. Its
API key is sealed with the existing machine-key envelope in
`data/market-monitor/typesafe/settings.json` under `OPENALICE_HOME`, written
atomically with mode 0600. Reads return presence, collection preference and
model only. Blank means preserve; removal is explicit. This provider is not a
chat runtime or a Workspace credential binding. The connection probe performs
a small real classification request. HTTP errors and transport exceptions are
sanitized, including provider authentication failures (HTTP 502 locally, never
Alice's session-logout 401). Requests go only to the fixed official HTTPS
endpoint, reject redirects and have bounded duration/response size.

Jev trend research pins `jev-1.13.0` and protocol
`jev-forward-sessions-v1`. Each request batches six independent choice
questions over public numeric market observations: return direction and evidence
adequacy separately for each of three horizons. Rolling returns, averages
and volume ratios are calculated in code; the previous rules' final labels,
free-form narration, provider error bodies and account information are not
sent. The saved rules directions provide a later comparator. Closed daily
bars must be fresh and valid, with at least 60 observations; stale/missing
hourly bars become explicitly missing. Public context includes source times,
status and retained-data provenance. It is not order-book or live-price input.

The first forecast for each asset/session date is append-only and reused by
subsequent requests. The journal saves the exact state/questions, model,
response, token usage, publication time, verified source-archive reference and
integrity digests. Requests are single-flight per asset. Publication is dated
when the response arrives, never at the last candle. A request spanning the
asset's date boundary is rejected. Optional automatic collection runs after
successful background scans, independently of scan success/cadence; failures
back off for an hour in the current runtime. Default is off. Reading the page
or refreshing results never calls the model.

Forward evaluation reuses the existing conservative session policy: the next
session open after publication through the 1st/7th/30th BTC close or the
1st/5th/20th equity close; flat is ±0.25%, inclusive. “Long” is explicitly an
approximately monthly window, not a multi-year assessment. Unknown equity
holiday gaps are excluded rather than inferred as valid sessions. Missing or
invalid archives cannot earn a score. The 90-day report exposes exclusions,
abstentions, pending cases, changed outcome providers and bounded history.
Jev versus rules accuracy uses their shared non-abstaining cohort. Always-up
uses all Jev-scored cases. Three-outcome Brier scores the exhaustive up/flat/down distribution on all
matured outcomes (sum of squared errors, range 0–2), even when the independent
evidence-adequacy question abstains. It is not renormalized. Evidence adequacy
is not a fourth possible market return.
Calibration bins display actual hit frequency for the selected directional
option, along with counts. Overlapping daily windows are descriptive samples,
not independent trades, profit estimates or proof of calibrated probability.
Old forecasts and live strategy thresholds are never rewritten by feedback.

The manual proposition audit accepts a public excerpt plus a claim and an
optional source URL. It classifies textual support and event completion status
in separate questions and archives the request/result. URLs are attribution
only: the route does not fetch them or claim to read full SEC filings. A
supported proposition does not establish a future market return.

API surface beneath `/api/market-monitor/typesafe`: GET/PUT `settings`, POST
`test`, GET `report?asset=BTC|TSLA|MSTR`, POST `forecast` with `{asset}`, POST
`audit` with `{source,claim,sourceUrl?}`. The demo implements every route with
explicit illustrative responses and never retains a submitted key. API keys
must be entered by the owner in the live settings form; never put them in a
command line, screenshot, fixture, log, journal or Git.
