# Apex Log Parser

## Description

`apex-log-parser` is a command-line tool designed to parse Salesforce Apex debug logs and output the structured log data as JSON. This makes it easier to analyze and process Apex logs programmatically.

It can process a single log file or multiple log files at once. 

The tool can also read from `stdin`, allowing it to be used in combination with other tools like `sf apex get log`. 

By default, JSON output contains `summary` and `events`. Use `--include-tree` when you also need the recursive execution tree in JSON, or `--include-context` when events should include their execution ancestry.

## Installation

To install the package globally from npm, use:

```bash
npm install -g apex-log-parser
```

## Usage

### Basic Usage

To parse a single log file:

```bash
apex-log-parser mylog.log
```

Files can be passed as arguments or with `-f`; both forms are equivalent and can be combined:

```bash
apex-log-parser -f mylog.log
```

To parse multiple log files:

```bash
apex-log-parser -f log1.log log2.log
```

You can also use wildcards to process multiple files:

```bash
apex-log-parser -f *.log
```

### Integration with `sf apex get log`

You can pipe the output of `sf apex get log` directly to `apex-log-parser`:

```bash
sf apex get log -i LOG_ID -o AliasOrg | apex-log-parser
```

To get the last 5 logs and parse them:

```bash
sf apex get log --number 5 -o AliasOrg | apex-log-parser
```

### Getting the Log ID in the Output

When analyzing multiple logs, it's useful to know which event came from which log. To get the Salesforce Log ID in the output, you can first download the logs to a directory and then parse them.

When you use the `--output-dir` flag, `sf apex get log` saves the logs to files where the filename is the Log ID. The command will automatically create the directory if it doesn't exist. `apex-log-parser` will then use this filename as the `source` for each event in the JSON output.

```bash
# 1. Download the logs to a directory (it will be created if it doesn't exist)
sf apex get log --number 5 -o AliasOrg --output-dir temp_logs

# 2. Parse the logs from the directory
apex-log-parser -f temp_logs/*.log

# 3. Clean up the directory
rm -rf temp_logs
```

This will produce a JSON output where `summary.source` and each event `source` contain the file basename (for example, `07L0x00000xxxxx...xxxx.log`). This allows you to easily group or filter events by their source log file.

### NDJSON stdin Mode

For tools that can provide both a log body and a real log identifier, use `--input-format ndjson`.

`stdin` must be newline-delimited JSON: one JSON object per line, with no wrapping array.

Each line must have this shape:

- `Id`: string
- `Log`: string
- `Request`: string, optional
- `Operation`: string, optional
- `LastModifiedDate`: string, optional
- `Status`: string, optional

Example line:

```json
{"Id":"07Lxx0000001234AAA","Request":"API","Operation":"ApexTestHandler","LastModifiedDate":"2026-04-17T09:00:00.000+0000","Status":"Success","Log":"64.0 APEX_CODE,INFO\n09:00:00.0 (1)|EXECUTION_STARTED"}
```

Notes:

- `Id` becomes `summary.source` and each event `source`
- `Request`, `Operation`, `LastModifiedDate`, and `Status` map to `summary.request`, `summary.operation`, `summary.lastModifiedDate`, and `summary.status`
- `Log` must contain the full Apex log as a JSON string
- Newlines inside `Log` must be escaped as `\n` in the JSON payload
- Blank lines are ignored
- Invalid JSON, missing required fields, or non-string NDJSON field values cause the command to exit with an error

Example:

```bash
printf '%s\n' '{"Id":"07Lxx0000001234AAA","Request":"API","Operation":"ApexTestHandler","LastModifiedDate":"2026-04-17T09:00:00.000+0000","Status":"Success","Log":"64.0 APEX_CODE,INFO\n09:00:00.0 (1)|EXECUTION_STARTED"}' \
  | apex-log-parser --input-format ndjson
```

In this mode, `summary.source` and each event `source` are set to `Id`, and any optional NDJSON metadata is copied into `summary`.

`summary.logLevels` is emitted as a compact object keyed by debug category, for example:

```json
"logLevels": {
  "APEX_CODE": "FINEST",
  "APEX_PROFILING": "INFO",
  "CALLOUT": "FINEST"
}
```

### Filtering Events

Use CLI filters for common event filtering while keeping the transaction `summary` in the output.

To get all `SOQL` events:

```bash
sf apex get log -i LOG_ID -o AliasOrg | apex-log-parser --type SOQL
```

To get all `DML` events that took longer than 1 second:

```bash
sf apex get log --number 25 -o AliasOrg | apex-log-parser --type DML --min-duration-ms 1000
```

To get all `System.debug` output (`USER_DEBUG` events):

```bash
sf apex get log -i LOG_ID -o AliasOrg | apex-log-parser --type USER_DEBUG
```

To exclude `LIMIT` events:

```bash
sf apex get log -i LOG_ID -o AliasOrg | apex-log-parser --exclude-type LIMIT
```

You can pass multiple event types with commas or repeated flags:

```bash
apex-log-parser -f mylog.log --type SOQL,DML
apex-log-parser -f mylog.log --type SOQL --type DML
```

Filters apply only to the flat `events` array. `summary` is preserved, any `--include-tree` output remains the full unfiltered tree, and logs with no matching events are omitted.

### Near-Limit Governor Report

Use `--near-limit` to report transactions with governor-limit pressure. This mode outputs `summary` and `nearLimitTransactions` instead of the flat `events` array, and logs with no near-limit matches are omitted.

```bash
sf apex get log --number 25 -o AliasOrg | apex-log-parser --near-limit
```

Repeated `LIMIT` snapshots are collapsed per `executionId`, scope, namespace, and limit, keeping the worst snapshot by usage percentage, current value, and latest timestamp. Apex test transactions are kept separate by their execution block.

Default thresholds are tuned for actionable pressure: SOQL, DML, CPU, and heap limits match at 70%; SOSL and callouts at 80%; email invocations and future calls at 90%. `QUEUEABLE_JOBS` and `MOBILE_APEX_PUSH` are ignored below 100% unless you opt in:

```bash
apex-log-parser -f mylog.log --near-limit --limit-threshold SOQL_QUERIES=60,QUEUEABLE_JOBS=80
```

Any limit at or above its max (`current >= max`) is always reported, even without a threshold, so a log that fails with `System.LimitException` is never silently omitted. Such matches report `threshold: 100`. Each match also includes `breached: true` when `current` exceeds `max`.

Exclude noisy limits when needed. Exclusions win, including over the at-limit rule:

```bash
apex-log-parser -f mylog.log --near-limit --exclude-limit QUEUEABLE_JOBS
```

`--near-limit` cannot be combined with `--tree`, `--include-tree`, `--include-context`, `--type`, `--exclude-type`, or `--min-duration-ms`.

### Event Context

Use `--include-context` when filtered events need to show where they happened in the execution stack.

```bash
apex-log-parser -f mylog.log --type SOQL --include-context
```

This adds a compact `context` object to each event:

```json
{
  "type": "SOQL",
  "object": "account",
  "context": {
    "stack": [
      {
        "id": "00003",
        "type": "CODE_UNIT",
        "name": "AccountTrigger on Account trigger event BeforeUpdate"
      },
      {
        "id": "00017",
        "type": "METHOD",
        "name": "MyClass.run",
        "lineNumber": 52
      }
    ]
  }
}
```

The stack contains meaningful ancestor nodes only, such as code units, methods, constructors, DML operations, flows, and managed package frames. It does not include the event itself.

### Filtering with `jq`

The JSON output can still be piped to `jq` for advanced filtering, grouping, sorting, and reshaping.

To get all `SOQL` events:

```bash
sf apex get log -i LOG_ID -o AliasOrg | apex-log-parser | jq '.events[] | select(.type == "SOQL")'
```

To get all `DML` events that took longer than 1 second:

```bash
sf apex get log --number 25 -o AliasOrg | apex-log-parser | jq '.events[] | select(.type == "DML" and .durationMs > 1000)'
```

To get the total execution time for a transaction:

```bash
sf apex get log -i LOG_ID -o AliasOrg | apex-log-parser | jq '.summary.durationMs'
```

Group queries by object (indetifying candidates for caching):

```bash
apex-log-parser -f .sfdx/tools/debug/logs/* | jq -s '
  [ .[] | .events[] | select(.type=="SOQL" and .object != null) | .object ]
  | group_by(.)
  | map({object: .[0], count: length})
  | sort_by(.count)
' 
```

### Tree View Output

For a more visual representation of the execution flow, you can use the `--tree` flag. This is especially useful for understanding the hierarchy of method calls and code unit execution.

```bash
apex-log-parser -f mylog.log --tree
```

This will produce an output that visually represents the execution tree, including duration and percentage of total execution time for each node:

```
ROOT(00001) [150ms|100%] ████████████████████
├── EXECUTION(00002) [150ms|100%] ████████████████████
│   ├── CODE_UNIT(00003) MyTrigger on Account trigger event BeforeInsert for [new] [70ms|46%] █████████
│   │   └── DML(00004) [50ms|33%] ████████
│   └── CODE_UNIT(00005) AnotherClass.someMethod [80ms|53%] ███████████
│       └── SOQL(00006) SOQL on Contact [20ms|13%] █
```

To include the recursive tree in JSON output, use `--include-tree`:

```bash
apex-log-parser -f mylog.log --include-tree
```

### Exit Codes

| Code | Meaning |
| ---- | ------- |
| `0` | Every input log was parsed successfully |
| `1` | Nothing was parsed: invalid options, no input files found, every log failed to parse, raw `stdin` contained no Apex log header, invalid NDJSON input, or no input was provided on an interactive terminal (help is printed to `stderr`) |
| `2` | Partial success: at least one log was parsed, but another file or raw `stdin` log could not be read or parsed |

Errors are reported on `stderr`; `stdout` only carries parsed output.

## Event Types

The `type` property in `events` corresponds to the kind of parsed log event. You can use these values with `--type`, `--exclude-type`, or tools like `jq`:

*   `CODE_UNIT`: A unit of code execution, such as a trigger or a class method.
*   `METHOD`: A method call.
*   `CONSTRUCTOR`: A constructor call.
*   `SYSTEM_METHOD`: A system method call.
*   `SOQL`: A SOQL query.
*   `DML`: A DML statement (e.g., insert, update, delete).
*   `EXCEPTION_THROWN`: An exception that was thrown but may be handled; execution continues. Includes `name` and `exceptionType`.
*   `FATAL_ERROR`: A terminal failure (unhandled exception, governor limit, etc.). Execution stops and the stack unwinds. Includes `name` and `exceptionType`.
*   `EXECUTION`: The start and end of the entire execution.
*   `FLOW`: A flow execution.
*   `FLOW_ELEMENT`: An element within a flow.
*   `FLOW_START_INTERVIEW`: The start of a flow interview.
*   `FLOW_BULK_ELEMENT`: A bulk element in a flow.
*   `MANAGED_PKG`: A managed package execution.
*   `CALLOUT`: A callout to an external service.
*   `LIMIT`: A limit usage warning.
*   `USER_DEBUG`: A `System.debug` statement. Includes `lineNumber`, `debugLevel` (e.g. `DEBUG`, `WARN`), and the full `message` text with `|` characters and newlines preserved.

When using `--include-tree`, the recursive tree also contains a synthetic `ROOT` node. `ROOT` is not present in `events` and is not accepted by event filter options.
