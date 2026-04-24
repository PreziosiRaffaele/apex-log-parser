export const HELP_TEXT = `
Usage:
  apex-log-parser [options]
  apex-log-parser -f <file1.log> [file2.log ...]
  sf debug retrieve ... | apex-log-parser [options]

Description:
  Parse Salesforce Apex debug logs into structured JSON or a human-readable tree.

Input:
  - Reads from stdin when -f is not provided
  - Accepts one or more .log files with -f
  - Supports one log or multiple logs in a single run
  - Emits one parsed result per input log
  - When parsing multiple logs, use jq -s to collect results into an array

Default JSON output:
  - summary   per-log summary such as source, user, startTime, durationMs, sizeMb, compact logLevels, and optional NDJSON metadata
  - events    flat event stream for filtering, grouping, and aggregation with jq

Notes:
  - JSON output is intended to be piped into jq
  - --tree prints a human-readable tree view instead of JSON
  - --include-tree includes the recursive tree in JSON output
  - Event filters preserve summary and filter only events, not tree
  - Logs with no matching events are omitted when filters are active

Options:
  -f <file1.log> [file2.log ...]
      Parse one or more Apex log files.
      Files must use the .log extension.
  --tree
      Print a human-readable execution tree instead of JSON.
  --include-tree
      Include the recursive execution tree in JSON output.
  --input-format <raw|ndjson>
      Select stdin parsing mode. raw splits concatenated Apex logs.
      ndjson expects one JSON object per line with string fields Id and Log.
      Optional string fields Request, Operation, LastModifiedDate, and Status
      are mapped to summary.request, summary.operation,
      summary.lastModifiedDate, and summary.status.
      The Log field must contain the full Apex log as a JSON string with \n escapes.
  --type <TYPE[,TYPE...]>
      Include only matching event types. Can be repeated.
  --exclude-type <TYPE[,TYPE...]>
      Exclude matching event types. Can be repeated.
      Exclusions win when a type is both included and excluded.
  --min-duration-ms <number>
      Include only events with durationMs greater than or equal to this value.
  --schema
      Print the JSON output schema and field reference.
  -v, --version
      Print the parser version.
  -h, --help
      Show this help message.

Examples:
  Parse a single file:
    apex-log-parser -f mylog.log

  Parse multiple files:
    apex-log-parser -f log1.log log2.log log3.log

  Parse from stdin:
    sf apex get log --number 1 -o MyOrg | apex-log-parser

  Parse NDJSON from stdin:
    cat logs.ndjson | apex-log-parser --input-format ndjson

  NDJSON line shape:
    {"Id":"07Lxx0000001234AAA","Request":"API","Operation":"ApexTestHandler","LastModifiedDate":"2026-04-17T09:00:00.000+0000","Status":"Success","Log":"64.0 APEX_CODE,INFO\n09:00:00.0 (1)|EXECUTION_STARTED"}

  Parse recent Apex test logs from an org:
    sf debug retrieve -o MyOrg --query "SELECT Id FROM ApexLog WHERE Operation = 'ApexTestHandler' ORDER BY StartTime DESC LIMIT 5" | apex-log-parser

  Collect multiple parsed logs into one JSON array:
    sf debug retrieve -o MyOrg --query "SELECT Id FROM ApexLog WHERE Operation = 'ApexTestHandler' ORDER BY StartTime DESC LIMIT 5" | apex-log-parser | jq -s '.'

  Show only SOQL events:
    ... | apex-log-parser --type SOQL

  Show only slow DML events:
    ... | apex-log-parser --type DML --min-duration-ms 1000

  Show the slowest events across multiple logs:
    ... | apex-log-parser | jq -s '[.[].events[] | select((.durationMs // 0) > 0)] | sort_by(.durationMs) | reverse[:20]'
`.trim();

export const SCHEMA_TEXT = `
JSON output schema:
  ParsedLog
    summary
      source      Input source identifier for the parsed log
      user        Salesforce user captured in the log when available
      startTime   Clock time of the first parsed log event in HH:MM:SS.mmm format
      request     NDJSON Request field when provided
      operation   NDJSON Operation field when provided
      lastModifiedDate NDJSON LastModifiedDate field when provided
      status      NDJSON Status field when provided
      durationMs  Total tracked execution time in milliseconds
      sizeMb      Raw log size in megabytes
      logLevels   Object keyed by Salesforce debug category with the configured level as value
    events[]
      Flat list of all parsed events. Common fields include:
      source        Input source identifier copied onto each flattened event
      id            Parser-generated event identifier unique within a log
      parentId      Parent event identifier; omitted for top-level events
      type          Event category such as METHOD, SOQL, DML, CALLOUT, or LIMIT
      name          Human-readable event label used in the tree view
      method        Method-style event name when the source log provides it
      lineNumber    Apex source line number associated with the event
      query         Full SOQL query text for SOQL events
      object        SObject or API name inferred or reported for the event
      rows          Row count reported for SOQL or DML events
      rowsReturned  Returned row count when explicitly captured by the parser
      operation     DML operation name such as Insert, Update, or Delete
      timeStart     Raw event start timestamp in nanoseconds
      timeEnd       Raw event end timestamp in nanoseconds for scoped events
      durationMs    Computed event duration in milliseconds rounded to 3 decimals
      exceptionType Exception class name for EXCEPTION_THROWN or FATAL_ERROR events
      limits        Governor limit usage object for LIMIT events
      request       Outbound request text for CALLOUT events
      response      Inbound response text for CALLOUT events
      namedCredentialRequest Named Credential request text for CALLOUT events
      namedCredentialResponse Named Credential response text for CALLOUT events
      namedCredentialResponseDetails Named Credential response details for CALLOUT events
      responseDetails Additional response detail text for CALLOUT events
    tree
      Recursive execution tree using the same event fields plus children[].
      Included only when using --include-tree. Rendered as human-readable text
      instead of JSON when using --tree.

Event types:
  CODE_UNIT, METHOD, SOQL, DML, EXCEPTION_THROWN, FATAL_ERROR,
  EXECUTION, FLOW, FLOW_ELEMENT, FLOW_START_INTERVIEW, FLOW_BULK_ELEMENT,
  MANAGED_PKG, CALLOUT, LIMIT

Notes:
  - events is the best starting point for jq filtering, grouping, and aggregation
  - default JSON output omits tree; use --include-tree to include it
  - --type, --exclude-type, and --min-duration-ms filter events while preserving summary and any included tree
  - ROOT is a synthetic tree node and is not present in events or accepted by event filters
  - logs with no matching events are omitted when filters are active
`.trim();
