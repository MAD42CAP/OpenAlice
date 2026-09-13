# Market Evidence Monitor

This guide owns the read-only BTC/TSLA evidence monitor, its persistence and
the `/market/evidence` dashboard. Market-data provider selection and candle
semantics remain owned by [[docs/market-data-architecture.md]].

## Product Boundary

The monitor organizes observable market evidence. It is not an execution
strategy and never accesses accounts, approvals, credentials or order writes.
Its initial asset registry contains:

| Asset | Bar symbol | Context |
|---|---|---|
| BTC | `BTC-USD` | Deribit public funding, perpetual/futures and options summaries |
| TSLA | `TSLA` | Configured OpenAlice equity/reference/news providers |

Daily and hourly candles are separate attributed requests through BarService.
If the hourly source fails, the UI reports it as unavailable; daily candles are
never relabelled as intraday data.

## Modules

- `src/domain/market-monitor/analysis.ts` owns the first strategy
  (`evidence-chain-v1`), semantic fingerprints and observation evaluation.
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
- `src/webui/routes/market-monitor.ts` exposes the read-only scan/history API
  and validated settings updates.
- `ui/src/pages/MarketEvidenceMonitorPage.tsx` owns the responsive dashboard,
  1D/1H switch, export and opt-in browser alerts. The status hook at
  `ui/src/hooks/useMarketMonitorStatus.ts` reads backend state; no browser
  timer owns market scans.

Adding another strategy now means implementing `MarketMonitorStrategy` and
registering it. It automatically appears in `GET /api/market-monitor/strategies`
and the dashboard settings selector; HTTP routes and React do not need new
decision rules. A new context source implements `MarketContextProvider` and may
be composed with existing providers for BTC, TSLA or a future asset.

## Runtime Behaviour

The page loads histories for both assets and source settings, and refreshes
the view while visible. Hidden pages pause view polling and reload on return;
they do not stop the backend. A refresh error keeps the last successful render
visible but labels the connection as unavailable rather than claiming it is
currently active. Empty histories require an explicit **Scan now** or enabling
background monitoring; opening multiple pages does not dispatch extra scans.

**Monitor settings → Background monitoring** is off by default. Enable it,
select BTC and/or TSLA, and save a cadence of 1–1440 minutes (default 15).
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
stop the other. Requests overlapping on one asset share one result and one
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

## Preview and Verification

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
monitor is rejected rather than interrupted. `--asset=TSLA` or `--asset=BTC`
can narrow the test.

The command accepts `--base-url=http://127.0.0.1:<port>` when Guardian selected
a non-default port, and writes `dist/market-monitor-acceptance.json`. Non-local
URLs are rejected unless the caller explicitly adds `--allow-remote`.

Mac/Electron acceptance must confirm desktop and narrow-window layout, live
timestamps, the 1D/1H switch, persistence after restart and no duplicate scan
records across a 24–72 hour observation window.

## Repository Scope

Development is retained in `MAD42CAP/OpenAlice` on
`feature/market-evidence-monitor`. The former upstream PR #1494 is closed and
unmerged. No upstream PR, release or third-party-team deployment is part of
this workflow. Preview/build commands above are local.
