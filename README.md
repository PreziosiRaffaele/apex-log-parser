# Apex Log Parser

## Description

`apex-log-parser` is a command-line tool designed to parse Salesforce Apex debug logs and output the structured log data as JSON. This makes it easier to analyze and process Apex logs programmatically.

It can process a single log file or multiple log files at once. 

The tool can also read from `stdin`, allowing it to be used in combination with other tools like `sf apex get log`. 

## Installation

To install the package globally from npm, use:

```bash
npm install -g apex-log-parser
```

## Usage

### Basic Usage

To parse a single log file:

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

This will produce a JSON output where each event has a `source` field containing the Log ID (e.g., `07L0x00000xxxxx...xxxx.log`). This allows you to easily group or filter events by their source log file.

### Filtering with `jq`

The JSON output can be piped to `jq` for powerful filtering and manipulation.

To get all `SOQL` events:

```bash
sf apex get log -i LOG_ID -o AliasOrg | apex-log-parser | jq '.events[] | select(.event === "SOQL")'
```

To get all `SOQL` events that took longer than 50ms:

```bash
sf apex get log --number 25 -o AliasOrg | apex-log-parser | jq '.events[] | select(.event === "SOQL" and .duration.total > 50)'
```

To get the total execution time for a transaction:

```bash
sf apex get log -i LOG_ID -o AliasOrg | apex-log-parser | jq '.meta.durationMs'
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

## Event Types

The `event` property in the JSON output corresponds to the type of log event. You can use these values to filter the output with tools like `jq`. Here are the possible event types:

*   `ROOT`: The root of the execution tree.
*   `CODE_UNIT`: A unit of code execution, such as a trigger or a class method.
*   `METHOD`: A method call.
*   `SOQL`: A SOQL query.
*   `DML`: A DML statement (e.g., insert, update, delete).
*   `EXCEPTION`: An exception that was thrown.
*   `EXECUTION`: The start and end of the entire execution.
*   `FLOW`: A flow execution.
*   `FLOW_ELEMENT`: An element within a flow.
*   `FLOW_START_INTERVIEW`: The start of a flow interview.
*   `FLOW_BULK_ELEMENT`: A bulk element in a flow.
*   `MANAGED_PKG`: A managed package execution.
*   `CALLOUT`: A callout to an external service.
*   `LIMIT`: A limit usage warning.
