# Apex Log Parser

## Description

`apex-log-parser` is a command-line tool designed to parse Salesforce Apex debug logs and output the structured log data as JSON. This makes it easier to analyze and process Apex logs programmatically.

## Installation

To install the package globally from npm, use:

```bash
npm install -g apex-log-parser
```

## Usage

Once installed, you can use the `apex-log-parser` command to parse one or more Apex log files.

```
Usage: apex-log-parser -f <file1> [file2] ...

Description:
  Parses one or more Apex log files and outputs the structured log data as JSON.

Options:
  -f <file1> [file2] ...  Specifies one or more Apex log files to parse.
                          Multiple files can be provided, separated by spaces.
                          Only files with a '.log' extension will be processed.

Examples:
  Parse a single log file:
    apex-log-parser -f mylog.log

  Parse multiple log files:
    apex-log-parser -f log1.log log2.log log3.log
```

### Output

The tool outputs the parsed log data in JSON format to standard output. For multiple files, the events from all files are combined into a single JSON array, with each event including a `source` field indicating the original file path.

