# Repository Instructions

## Project Overview

`apex-log-parser` is a TypeScript command-line tool and library for parsing Salesforce Apex debug logs into structured JSON. It supports file input, raw stdin, NDJSON stdin, event filtering, optional execution trees, human-readable tree rendering, and compact event context for log analysis.

The default CLI output is JSON shaped around `summary` and flat `events`. Optional flags add richer output:

- `--tree` renders a human-readable execution tree instead of JSON.
- `--include-tree` includes the recursive tree in JSON.
- `--include-context` adds compact ancestor context to flat events.
- `--type`, `--exclude-type`, and `--min-duration-ms` filter flat events.

## Folder Structure

- `src/`: TypeScript source for the parser, CLI, output rendering, and utilities.
- `src/ApexLogParser.ts`: Core parser that builds the execution tree, summary, flat events, and optional event context.
- `src/cli.ts`: CLI argument parsing, stdin/file handling, event filtering, and JSON/tree output orchestration.
- `src/types.ts`: Public data shapes and API types exported to library consumers.
- `src/TreeRenderer.ts`: Human-readable tree output renderer for `--tree`.
- `src/ApexLogSplitter.ts`: Raw stdin log splitter for streams containing one or more logs.
- `src/ParserUtils.ts`: Stateless parsing helpers for timestamps, rows, objects, log levels, and governor limits.
- `src/cliText.ts`: Help text and schema text shown by CLI flags.
- `dist/`: Generated build output from TypeScript. Do not edit manually.
- `docs/`: Project documentation assets, if any.
- `test/`: Test area. Add tests here if the project adopts test files.
- `package.json`: Package metadata, npm scripts, CLI bin entry, and dependencies.

## Documentation Policy

Prefer code and types as the source of truth. Use inline comments sparingly because extensive method descriptions can become stale or misleading for agents.

### In Code

Add JSDoc only when it captures a contract that is not obvious from names, types, and local code:

- Exported or public APIs.
- Parser invariants, ordering, or tree/context behavior.
- Filtering precedence or output-shape guarantees.
- Process exit behavior or non-obvious side effects.
- Validation methods whose failure behavior matters to callers.
- Data shape compatibility guarantees.

Avoid long method descriptions, implementation walkthroughs, or comments that restate parameter names, return types, or implementation steps. If a comment becomes longer than the method or needs frequent updates, move the explanation to README or `docs/`.

Good comments answer: what invariant must not be broken?

### In Docs

Put human-oriented explanations, examples, workflows, and rationale in README or `docs/`, not inline method comments.

### For Agents

When modifying code, verify comments against the implementation. If a comment conflicts with code or tests, treat code/tests as the source of truth and update or remove the comment.
