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
  - summary   per-log summary such as source, user, startTime, durationMs, sizeMb, logLevels, and optional NDJSON metadata
  - events    flat event stream for filtering, grouping, and aggregation with jq
  - tree      hierarchical execution view of the parsed log

Notes:
  - JSON output is intended to be piped into jq
  - --tree prints a human-readable tree view instead of JSON

Options:
  -f <file1.log> [file2.log ...]
      Parse one or more Apex log files.
      Files must use the .log extension.
  --tree
      Print a human-readable execution tree instead of JSON.
  --input-format <raw|ndjson>
      Select stdin parsing mode. raw splits concatenated Apex logs.
      ndjson expects one JSON object per line with string fields Id and Log.
      Optional string fields Request, Operation, LastModifiedDate, and Status
      are mapped to summary.request, summary.operation,
      summary.lastModifiedDate, and summary.status.
      The Log field must contain the full Apex log as a JSON string with \n escapes.
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

  Show only slow events:
    ... | apex-log-parser | jq '.events | map(select((.durationMs // 0) > 2000))'

  Exclude LIMIT events during analysis:
    ... | apex-log-parser | jq '.events | map(select(.type != "LIMIT"))'

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
      logLevels[]
        type      Salesforce debug category
        level     Configured level for that category
    events[]
      Flat list of all parsed events. Common fields include:
      id, parentId, type, name, method, lineNumber, query, object, rows,
      rowsReturned, operation, timeStart, timeEnd, durationMs, exceptionType,
      limits, request/response callout fields, and source
    tree
      Recursive execution tree using the same event fields plus children[]

Event types:
  ROOT, CODE_UNIT, METHOD, SOQL, DML, EXCEPTION_THROWN, FATAL_ERROR,
  EXECUTION, FLOW, FLOW_ELEMENT, FLOW_START_INTERVIEW, FLOW_BULK_ELEMENT,
  MANAGED_PKG, CALLOUT, LIMIT

Notes:
  - events is the best starting point for jq filtering, grouping, and aggregation
  - tree is included in the JSON output and rendered as human-readable text when using --tree
`.trim();
