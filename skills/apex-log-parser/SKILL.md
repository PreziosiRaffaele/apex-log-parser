---
name: apex-log-parser
description: Triage Salesforce Apex debug logs with the apex-log-parser CLI. Use when asked to analyse an Apex debug log (.log file or `sf apex get log` output) for errors, governor-limit pressure, slow code, or repeated SOQL queries.
---

# Apex log triage with apex-log-parser

`apex-log-parser` turns an Apex debug log into JSON: one document per log with a `summary` object and a flat `events` array. Real logs produce thousands of events, so never print the full default output. Always narrow it with flags or `jq` first.

Input: pass `.log` files as arguments (`apex-log-parser my.log`) or pipe raw logs on stdin (`sf apex get log -i <ID> -o <org> | apex-log-parser`). For the exact output shape, run `apex-log-parser --json-schema` (JSON Schema) or `apex-log-parser --schema` (field reference).

## Triage workflow

Follow these steps in order. Stop as soon as you have found the cause.

### 1. Check the summary and fatal errors

```bash
apex-log-parser my.log | jq '.summary'
apex-log-parser my.log --type FATAL_ERROR | jq '.events[] | {message, exceptionType, stackTrace}'
```

`summary.durationMs` is the total tracked execution time. `summary.logLevels` shows the debug levels the log was captured with. If `APEX_CODE` is below `FINE`, method and debug events may be missing.

`FATAL_ERROR` events have `message` (the exception message) and `stackTrace` (`[{frame, lineNumber, column}]`, innermost frame first). The second command prints nothing when the transaction did not fail.

### 2. Check governor-limit pressure

```bash
apex-log-parser my.log --near-limit
```

The command prints `summary` and `nearLimitTransactions[].matches[]` (limit, current, max, usagePercentage), or nothing when no limit crosses its threshold. To see more, lower the thresholds or opt into ignored limits:

```bash
apex-log-parser my.log --near-limit --limit-threshold SOQL_QUERIES=50,QUEUEABLE_JOBS=100
```

`--near-limit` cannot be combined with `--type`, `--exclude-type`, `--min-duration-ms`, `--include-context`, `--tree`, or `--include-tree`.

### 3. Find slow events and where they ran

```bash
apex-log-parser my.log --min-duration-ms 500 --exclude-type EXECUTION,CODE_UNIT --include-context \
  | jq -c '.events | sort_by(-.durationMs)[:15][] | {type, name, durationMs, lineNumber, caller: .context.stack[-1].name}'
```

`context.stack` lists meaningful ancestors (code units, methods, DML, flows), outermost first. It does not include the event itself. Nested frames all report long durations, so the deepest slow frame is usually the culprit.

### 4. Find repeated SOQL queries

```bash
apex-log-parser my.log --type SOQL --include-context \
  | jq -c '.events | group_by(.query) | map({count: length, object: .[0].object, query: .[0].query, callers: ([.[].context.stack[-1].name] | unique)}) | sort_by(-.count)[:10][]'
```

A query that runs many times from the same caller usually means a query inside a loop. Use `--type DML --include-context` in the same way for repeated DML.

## Other useful jq recipes

```bash
# Event counts by type
apex-log-parser my.log | jq '.events | group_by(.type) | map({type: .[0].type, count: length})'

# Total SOQL time and rows
apex-log-parser my.log --type SOQL | jq '{count: (.events | length), ms: ([.events[].durationMs // 0] | add), rows: ([.events[].rows // 0] | add)}'

# System.debug output
apex-log-parser my.log --type USER_DEBUG | jq -r '.events[] | "\(.lineNumber) \(.debugLevel) \(.message)"'

# Handled exceptions (thrown but not fatal)
apex-log-parser my.log --type EXCEPTION_THROWN --include-context | jq -c '.events[] | {name, caller: .context.stack[-1].name}'

# Several logs at once: collect the documents into an array first
apex-log-parser logs/*.log | jq -s 'map({source: .summary.source, durationMs: .summary.durationMs})'
```

## Keep output small

- Never print unfiltered output. Always use `--type`, `--exclude-type`, or `--min-duration-ms`, and pipe to `jq`.
- In `jq`, project only the fields you need (`{type, name, durationMs}`), cap lists with `[:N]`, and use `-c` for one line per item.
- Use `--include-context` only together with a filter. It adds an ancestor stack to every event.
- Avoid `--include-tree` and `--tree` on large logs, because they print every node. Use them only on small logs, or when you need the full call hierarchy.
- `LIMIT` events are verbose. Prefer `--near-limit`, or add `--exclude-type LIMIT`.
- When filters are active, logs with no matching events print nothing. Empty output is a valid answer, not an error.
