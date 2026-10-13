---
name: apex-log-parser
description: Triage Salesforce Apex debug logs with the apex-log-parser CLI. Use when asked to analyse an Apex debug log (.log file or `sf apex get log` output) for failures, governor-limit pressure, slow operations, or repeated SOQL/DML.
---

# Apex log triage with apex-log-parser

`apex-log-parser` turns an Apex debug log into JSON. It writes one document per log: a `summary` object plus a mode-specific array. In default mode the array is `events`. With `--near-limit` it is `nearLimitTransactions`, and with `--hotspots` it is `hotspots`. Real logs produce thousands of events, so never print the full default output. Start from the summary and the aggregate modes, and narrow everything else with flags and `jq`.

Input: pass `.log` files as arguments (`apex-log-parser my.log`) or pipe raw logs on stdin (`sf apex get log -i <ID> -o <org> | apex-log-parser`). Run `apex-log-parser --schema` for the full field reference and `apex-log-parser --help` for every flag.

## Triage workflow

Follow these steps in order. Stop as soon as you have found the cause.

### 1. Read the summary triage fields

```bash
apex-log-parser my.log | jq '.summary | {outcome, errors, counts, peakLimits}'
```

These fields are present in every JSON mode (default, `--near-limit` and `--hotspots`; `--tree` prints text instead). They are always computed from the full log: `--type`, `--exclude-type` and `--min-duration-ms` never change them.

- `outcome`: `fatal` if the log contains a `FATAL_ERROR`, otherwise `success`.
- `errors[]`: one entry per fatal error, with `eventId`, `exceptionType`, `message` (no stack trace) and, when available, `lineNumber` (from the stack trace). A fatal error that Salesforce logs twice in a row appears once. The field is absent when there are no fatal errors.
- `counts`: totals for `soql`, `dml`, `callouts`, `exceptionsThrown`, `fatalErrors` and `userDebug`. Many SOQL or DML statements point to work inside a loop.
- `peakLimits`: the worst snapshot of each governor limit, as `{current, max, usagePercentage, namespace}`. Only limits that were used (`current > 0`) appear.

To see the full fatal error event, including where it sits in the call stack:

```bash
apex-log-parser my.log --type FATAL_ERROR --include-context | jq '.events[]'
```

`summary.durationMs` is the total tracked time. `summary.logLevels` shows the levels the log was captured with. If `APEX_CODE` is below `FINE`, method and debug events may be missing.

### 2. Check governor-limit pressure

```bash
apex-log-parser my.log --near-limit | jq '.nearLimitTransactions[] | {label, matches: [.matches[] | {limit, current, max, usagePercentage, breached, threshold}]}'
```

- Each transaction lists the limits that crossed their threshold. Defaults: SOQL, DML, CPU and heap at 70%; SOSL and callouts at 80%; email invocations and future calls at 90%.
- Any limit at or above its max (`current >= max`) is always reported, including limits with no configured threshold such as `QUEUEABLE_JOBS`. `threshold` is the configured threshold (default or `--limit-threshold`) when there is one, and `100` only for limits without one.
- `breached: true` means `current` exceeded `max`, so the limit was actually blown. Use `breached`, not `threshold`, to detect blown limits. That usually explains a `System.LimitException` from step 1.
- Tune with `--limit-threshold LIMIT=percent`. Silence noise with `--exclude-limit LIMIT`. Exclusions always win, even over the at-or-above-max rule.

```bash
apex-log-parser my.log --near-limit --limit-threshold SOQL_QUERIES=50,QUEUEABLE_JOBS=80 --exclude-limit CPU_TIME --compact
```

`--near-limit` cannot be combined with `--type`, `--exclude-type`, `--min-duration-ms`, `--include-context`, `--tree`, `--include-tree` or `--hotspots`.

### 3. Find the slow operations with `--hotspots`

```bash
apex-log-parser my.log --hotspots --top 10 | jq -c '.hotspots[] | {type, name, count, totalSelfMs, maxSelfMs, inclusiveMs, line: .slowest.lineNumber, caller: .slowest.context.stack[-1].name}'
```

Prefer `--hotspots` over `--min-duration-ms` for finding where the time goes:

- `durationMs` is inclusive: a parent's duration includes all of its children. Filtering with `--min-duration-ms` therefore returns the whole ancestor chain of one slow operation (trigger, handler, method, ...), every entry with a large duration.
- `selfMs` is exclusive time: the node's `durationMs` minus its direct children's. `--hotspots` groups events by type and name, and ranks them by total self time. The top entry is the operation that actually consumed the time.

The fields of each hotspot:

| Field | Meaning |
| --- | --- |
| `count` | Number of occurrences |
| `totalSelfMs` / `maxSelfMs` | Sum and maximum of the occurrences' self time |
| `inclusiveMs` | Total `durationMs` of outermost occurrences only, so recursion is not double-counted |
| `slowest` | The occurrence with the highest `selfMs`: `id`, `durationMs`, `selfMs`, `lineNumber`, and `context.stack` (its ancestors, outermost first) |

DML is grouped by operation and object, and callouts by request. `EXECUTION`, `LIMIT`, `EXCEPTION_THROWN`, `FATAL_ERROR` and `USER_DEBUG` are never hotspots. `--type`/`--exclude-type` restrict which events are grouped, for example `--hotspots --type SOQL,DML`. `--hotspots` cannot be combined with `--tree`, `--include-tree`, `--near-limit` or `--min-duration-ms`.

`--min-duration-ms` is still useful for listing slow events of one type with their call stack:

```bash
apex-log-parser my.log --type DML,CALLOUT --min-duration-ms 500 --include-context | jq -c '.events[] | {type, name, durationMs, selfMs, caller: .context.stack[-1].name}'
```

### 4. Find repeated SOQL queries

```bash
apex-log-parser my.log --type SOQL --include-context | jq -c '.events | group_by(.query) | map({count: length, object: .[0].object, query: .[0].query, callers: ([.[].context.stack[-1].name] | unique)}) | sort_by(-.count)[:10][]'
```

A query that runs many times from the same caller usually means a query inside a loop. Find repeated DML the same way, grouped by operation and object (DML names include the row count, so don't group by `name`):

```bash
apex-log-parser my.log --type DML --include-context | jq -c '.events | group_by([.operation, .object]) | map({count: length, operation: .[0].operation, object: .[0].object, callers: ([.[].context.stack[-1].name] | unique)}) | sort_by(-.count)[:10][]'
```

## Other useful jq recipes

```bash
# Event counts by type
apex-log-parser my.log | jq -c '.events | group_by(.type) | map({type: .[0].type, count: length})'

# Total SOQL time and rows
apex-log-parser my.log --type SOQL | jq -c '{count: (.events | length), ms: ([.events[].durationMs // 0] | add), rows: ([.events[].rows // 0] | add)}'

# System.debug output
apex-log-parser my.log --type USER_DEBUG | jq -r '.events[] | "\(.lineNumber) \(.debugLevel) \(.message)"'

# Handled exceptions (thrown but not fatal) and where they were thrown
apex-log-parser my.log --type EXCEPTION_THROWN --include-context | jq -c '.events[] | {name, caller: .context.stack[-1].name}'

# Several logs at once: one line per log with outcome and duration
apex-log-parser logs/*.log --type FATAL_ERROR --compact | jq -c '{source: .summary.source, outcome: .summary.outcome, durationMs: .summary.durationMs, errors: .summary.errors}'
```

## Keep output small

- Never print unfiltered default output. Use `--type`, `--exclude-type` or `--min-duration-ms`, or an aggregate mode (`--near-limit`, `--hotspots --top N`), and pipe to `jq`.
- In `jq`, project only the fields you need (`{type, name, selfMs}`), cap lists with `[:N]`, and use `-c` for one line per item.
- Use `--compact` to print each result on one line. Several logs then form NDJSON, which `jq -c` can process line by line, or `jq -s` can collect into an array. `--compact` works with every JSON mode, but not with `--tree`.
- `--include-context` adds an ancestor stack to every event, so use it only together with a filter.
- Avoid an unbounded `--tree` or `--include-tree` on large logs. Bound them instead:
  - `--max-depth N` prunes nodes deeper than `N` (`ROOT` is depth 0). `--tree` prints `… N descendants hidden` in their place. `--include-tree` drops their `children` and sets `hiddenDescendants` on the pruned node. It never changes `events`.
  - `--tree --min-duration-ms 500` shows only the slow paths. It keeps the ancestors of kept nodes, and collapses hidden siblings into one `… N nodes hidden [Xms total]` line.

```bash
apex-log-parser my.log --tree --max-depth 4 --min-duration-ms 100
apex-log-parser my.log --include-tree --max-depth 3 --compact | jq -c '.tree'
```

- `LIMIT` events are verbose. Read `summary.peakLimits` or use `--near-limit`, and add `--exclude-type LIMIT` when listing events.

## Empty results and exit codes

Every parsed log is always emitted, even when nothing matches. `"events": []`, `"nearLimitTransactions": []` and `"hotspots": []` mean "nothing found". They are a valid answer, not a failure.

| Exit code | Meaning |
| --- | --- |
| `0` | Every input log was parsed |
| `1` | Failure: invalid options, no input files found, every log failed, raw stdin had no Apex log header, or no input on an interactive terminal. With `--input-format ndjson`, any invalid line or failed log (see below) |
| `2` | Partial success (files or raw stdin only): some logs were parsed, but another file or stdin log could not be read or parsed |

With `--input-format ndjson`, the CLI stops at the first invalid line or log that fails to parse and exits `1`, after the results of earlier lines have already been printed. It never exits `2`.

Errors go to stderr. stdout carries only parsed output, so piping into `jq` is safe.
