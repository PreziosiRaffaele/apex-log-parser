#!/usr/bin/env node
import readline from 'readline';
import { ApexLogParser } from './index.js';
import type { ParsedLog, EventNode, NodeType, LimitType } from './index.js';
import { ApexLogSplitter, LogData } from './ApexLogSplitter.js';
import { HELP_TEXT, SCHEMA_TEXT } from './cliText.js';
import { TreeRenderer } from './TreeRenderer.js';
import { checkFileExists, cleanAnsiCodes } from './cliUtils.js';
import { buildHotspotReport, DEFAULT_HOTSPOT_TOP } from './HotspotReport.js';
import { buildNearLimitReport, createDefaultNearLimitThresholds, isLimitType, LIMIT_TYPES, type NearLimitOptions } from './NearLimitReport.js';
import { promises as fs, readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseNodeArgs } from 'node:util';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ParsedArgs = {
    files: string[];
    tree: boolean;
    includeTree: boolean;
    includeContext: boolean;
    inputFormat: 'raw' | 'ndjson';
    filters: EventFilters;
    nearLimit: boolean;
    nearLimitOptions: NearLimitOptions;
    hotspots: boolean;
    top: number;
}

type EventFilters = {
    includeTypes: Set<NodeType>;
    excludeTypes: Set<NodeType>;
    minDurationMs?: number;
};

type CliOutputOptions = {
    tree: boolean;
    includeTree: boolean;
    includeContext: boolean;
    filters: EventFilters;
    nearLimit: boolean;
    nearLimitOptions: NearLimitOptions;
    hotspots: boolean;
    top: number;
};

type CliJsonOutput = {
    summary: ParsedLog['summary'];
    tree?: ParsedLog['tree'];
    events: EventNode[];
};

type NdjsonInput = {
    Id: string;
    Log: string;
    Request?: string;
    Operation?: string;
    LastModifiedDate?: string;
    Status?: string;
};

const OPTIONAL_NDJSON_STRING_FIELDS = ['Request', 'Operation', 'LastModifiedDate', 'Status'] as const;
const EVENT_TYPES = new Set<NodeType>([
    'CODE_UNIT',
    'METHOD',
    'CONSTRUCTOR',
    'SYSTEM_METHOD',
    'SOQL',
    'DML',
    'EXCEPTION_THROWN',
    'FATAL_ERROR',
    'EXECUTION',
    'FLOW',
    'FLOW_ELEMENT',
    'FLOW_START_INTERVIEW',
    'FLOW_BULK_ELEMENT',
    'MANAGED_PKG',
    'CALLOUT',
    'LIMIT',
    'USER_DEBUG',
]);

/**
 * Parses the command line arguments and returns the parsed arguments.
 * @param args The command line arguments.
 * @returns The parsed arguments including files and tree flag.
 */
function parseArgs(args: string[]): ParsedArgs {
    try {
        const { values, tokens } = parseNodeArgs({
            args,
            allowPositionals: true,
            strict: true,
            tokens: true,
            options: {
                help: { type: 'boolean', short: 'h' },
                version: { type: 'boolean', short: 'v' },
                schema: { type: 'boolean' },
                tree: { type: 'boolean' },
                'include-tree': { type: 'boolean' },
                'include-context': { type: 'boolean' },
                'input-format': { type: 'string' },
                type: { type: 'string', multiple: true },
                'exclude-type': { type: 'string', multiple: true },
                'min-duration-ms': { type: 'string' },
                'near-limit': { type: 'boolean' },
                'limit-threshold': { type: 'string', multiple: true },
                'exclude-limit': { type: 'string', multiple: true },
                hotspots: { type: 'boolean' },
                top: { type: 'string' },
                f: { type: 'string', multiple: true, short: 'f' },
            },
        });

        if (values.help) showUsage();
        if (values.version) showVersion();
        if (values.schema) showSchema();

        const inputFormatValue = values['input-format'];
        if (inputFormatValue !== undefined && inputFormatValue !== 'raw' && inputFormatValue !== 'ndjson') {
            console.error('Invalid value for --input-format. Expected "raw" or "ndjson".');
            process.exit(1);
        }

        const filters = parseEventFilters(values.type, values['exclude-type'], values['min-duration-ms']);
        const tree = values.tree ?? false;
        const includeTree = values['include-tree'] ?? false;
        const includeContext = values['include-context'] ?? false;
        const hasFilters = hasActiveFilters(filters);
        const nearLimit = values['near-limit'] ?? false;

        if (!nearLimit && hasNearLimitOptions(values['limit-threshold'], values['exclude-limit'])) {
            console.error('Cannot use --limit-threshold or --exclude-limit without --near-limit.');
            process.exit(1);
        }

        const nearLimitOptions = parseNearLimitOptions(values['limit-threshold'], values['exclude-limit']);
        const hotspots = values.hotspots ?? false;

        if (!hotspots && values.top !== undefined) {
            console.error('Cannot use --top without --hotspots.');
            process.exit(1);
        }

        const top = parseTop(values.top);

        if (tree && includeTree) {
            console.error('Cannot combine --tree with --include-tree.');
            process.exit(1);
        }
        if (tree && includeContext) {
            console.error('Cannot combine --tree with --include-context.');
            process.exit(1);
        }
        if (hasFilters && tree) {
            console.error('Cannot combine event filters with --tree.');
            process.exit(1);
        }
        if (hotspots) {
            const incompatibleHotspotFlags = getHotspotIncompatibleFlags(tree, includeTree, nearLimit, filters);
            if (incompatibleHotspotFlags.length > 0) {
                console.error(`Cannot combine --hotspots with ${incompatibleHotspotFlags.join(', ')}.`);
                process.exit(1);
            }
        }
        if (nearLimit) {
            const incompatibleNearLimitFlags = getNearLimitIncompatibleFlags(tree, includeTree, includeContext, filters);
            if (incompatibleNearLimitFlags.length > 0) {
                console.error(`Cannot combine --near-limit with ${incompatibleNearLimitFlags.join(', ')}.`);
                process.exit(1);
            }
        }

        // -f values and positionals are both input files, kept in command-line order.
        const files = tokens.flatMap((token) => {
            if (token.kind === 'positional') return [token.value];
            if (token.kind === 'option' && token.name === 'f' && token.value !== undefined) return [token.value];
            return [];
        });

        return {
            files,
            tree,
            includeTree,
            includeContext,
            inputFormat: inputFormatValue ?? 'raw',
            filters,
            nearLimit,
            nearLimitOptions,
            hotspots,
            top,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    }
}

function hasNearLimitOptions(
    thresholdValues: string[] | undefined,
    excludeLimitValues: string[] | undefined,
): boolean {
    return (thresholdValues?.length ?? 0) > 0 || (excludeLimitValues?.length ?? 0) > 0;
}

function parseNearLimitOptions(
    thresholdValues: string[] | undefined,
    excludeLimitValues: string[] | undefined,
): NearLimitOptions {
    const thresholds = createDefaultNearLimitThresholds();
    const excludedLimits = parseLimitTypes(excludeLimitValues, '--exclude-limit');

    for (const value of thresholdValues ?? []) {
        for (const rawEntry of value.split(',')) {
            const entry = rawEntry.trim();
            if (entry.length === 0) continue;

            const equalsIndex = entry.indexOf('=');
            if (equalsIndex === -1 || entry.indexOf('=', equalsIndex + 1) !== -1) {
                console.error(`Invalid value for --limit-threshold: ${entry}. Expected LIMIT=percentage.`);
                process.exit(1);
            }

            const rawLimit = entry.slice(0, equalsIndex).trim();
            const rawThreshold = entry.slice(equalsIndex + 1).trim();
            const limit = parseLimitType(rawLimit, '--limit-threshold');
            const threshold = Number(rawThreshold);

            if (rawThreshold.length === 0 || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
                console.error(`Invalid percentage for --limit-threshold ${rawLimit}: ${rawThreshold}. Expected a number from 0 to 100.`);
                process.exit(1);
            }

            thresholds.set(limit, threshold);
        }
    }

    return { thresholds, excludedLimits };
}

function parseLimitTypes(values: string[] | undefined, optionName: string): Set<LimitType> {
    const limitTypes = new Set<LimitType>();

    for (const value of values ?? []) {
        for (const rawType of value.split(',')) {
            const trimmedType = rawType.trim();
            if (trimmedType.length === 0) continue;
            limitTypes.add(parseLimitType(trimmedType, optionName));
        }
    }

    return limitTypes;
}

function parseLimitType(rawType: string, optionName: string): LimitType {
    const normalizedType = rawType.trim().toUpperCase();

    if (!isLimitType(normalizedType)) {
        console.error(`Invalid limit type for ${optionName}: ${rawType.trim()}. Expected one of: ${LIMIT_TYPES.join(', ')}.`);
        process.exit(1);
    }

    return normalizedType;
}

function parseTop(value: string | undefined): number {
    if (value === undefined) return DEFAULT_HOTSPOT_TOP;

    const top = Number(value);
    if (!/^\d+$/.test(value) || top < 1) {
        console.error('Invalid value for --top. Expected a positive integer.');
        process.exit(1);
    }

    return top;
}

function getHotspotIncompatibleFlags(
    tree: boolean,
    includeTree: boolean,
    nearLimit: boolean,
    filters: EventFilters,
): string[] {
    const incompatibleFlags: string[] = [];

    if (tree) incompatibleFlags.push('--tree');
    if (includeTree) incompatibleFlags.push('--include-tree');
    if (nearLimit) incompatibleFlags.push('--near-limit');
    if (filters.minDurationMs !== undefined) incompatibleFlags.push('--min-duration-ms');

    return incompatibleFlags;
}

function getNearLimitIncompatibleFlags(
    tree: boolean,
    includeTree: boolean,
    includeContext: boolean,
    filters: EventFilters,
): string[] {
    const incompatibleFlags: string[] = [];

    if (tree) incompatibleFlags.push('--tree');
    if (includeTree) incompatibleFlags.push('--include-tree');
    if (includeContext) incompatibleFlags.push('--include-context');
    if (filters.includeTypes.size > 0) incompatibleFlags.push('--type');
    if (filters.excludeTypes.size > 0) incompatibleFlags.push('--exclude-type');
    if (filters.minDurationMs !== undefined) incompatibleFlags.push('--min-duration-ms');

    return incompatibleFlags;
}

function parseEventFilters(
    includeTypeValues: string[] | undefined,
    excludeTypeValues: string[] | undefined,
    minDurationMsValue: string | undefined,
): EventFilters {
    return {
        includeTypes: parseEventTypes(includeTypeValues, '--type'),
        excludeTypes: parseEventTypes(excludeTypeValues, '--exclude-type'),
        minDurationMs: parseMinDurationMs(minDurationMsValue),
    };
}

function parseEventTypes(values: string[] | undefined, optionName: string): Set<NodeType> {
    const eventTypes = new Set<NodeType>();

    for (const value of values ?? []) {
        for (const rawType of value.split(',')) {
            const normalizedType = rawType.trim().toUpperCase();
            if (normalizedType.length === 0) continue;
            if (!EVENT_TYPES.has(normalizedType as NodeType)) {
                console.error(`Invalid event type for ${optionName}: ${rawType.trim()}. Expected one of: ${Array.from(EVENT_TYPES).join(', ')}.`);
                process.exit(1);
            }
            eventTypes.add(normalizedType as NodeType);
        }
    }

    return eventTypes;
}

function parseMinDurationMs(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;

    const minDurationMs = Number(value);
    if (!Number.isFinite(minDurationMs) || minDurationMs < 0) {
        console.error('Invalid value for --min-duration-ms. Expected a non-negative number.');
        process.exit(1);
    }

    return minDurationMs;
}

function hasActiveFilters(filters: EventFilters): boolean {
    return filters.includeTypes.size > 0 || filters.excludeTypes.size > 0 || filters.minDurationMs !== undefined;
}

function showVersion(): never {
    const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
    try {
        const packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);
        console.log(packageJson.version);
    } catch (error) {
        console.error(`Error reading version from package.json: ${error}`);
    }
    process.exit(0);
}

function showUsage(): never {
    console.log(HELP_TEXT);
    process.exit(0);
}

function showSchema(): never {
    console.log(SCHEMA_TEXT);
    process.exit(0);
}

async function parseFile(parser: ApexLogParser, filePath: string, options: CliOutputOptions): Promise<{ success: true; data: ParsedLog } | { success: false; error: string }> {
    try {
        const logContent = await fs.readFile(filePath, 'utf-8');
        const apexLog = parser.parse(logContent, path.basename(filePath), { includeContext: options.includeContext || options.hotspots });
        return { success: true, data: apexLog };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error parsing ${filePath}: ${message}`);
        return { success: false, error: message };
    }
}


async function verifyLogFile(filePath: string, logSkipMessage: boolean = false): Promise<boolean> {
    if (path.extname(filePath) !== '.log') {
        if (logSkipMessage) console.error(`Skipping non-.log file: ${filePath}`);
        return false;
    }
    try {
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) {
            if (logSkipMessage) console.error(`Not a file: ${filePath}`);
            return false;
        }
    } catch {
        if (logSkipMessage) console.error(`File not found: ${filePath}`);
        return false;
    }
    const exists = await checkFileExists(filePath);
    return exists;
}

function outputResult(data: ParsedLog, options: CliOutputOptions): void {
    if (options.tree) {
        console.log(new TreeRenderer().renderTree(data));
    } else if (options.hotspots) {
        const output = buildHotspotReport(data.summary, filterEvents(data.events, options.filters), options.top);
        if (!output) return;
        console.log(JSON.stringify(output, null, 2));
    } else if (options.nearLimit) {
        const output = buildNearLimitReport(data, options.nearLimitOptions);
        if (!output) return;
        console.log(JSON.stringify(output, null, 2));
    } else {
        const output = createJsonOutput(data, options);
        if (!output) return;
        console.log(JSON.stringify(output, null, 2));
    }
}

function createJsonOutput(data: ParsedLog, options: CliOutputOptions): CliJsonOutput | undefined {
    const filteredEvents = filterEvents(data.events, options.filters);
    if (hasActiveFilters(options.filters) && filteredEvents.length === 0) {
        return undefined;
    }

    const output: CliJsonOutput = {
        summary: data.summary,
        events: filteredEvents,
    };

    if (options.includeTree) {
        output.tree = data.tree;
    }

    return output;
}

function filterEvents(events: EventNode[], filters: EventFilters): EventNode[] {
    return events.filter((event) => {
        if (filters.includeTypes.size > 0 && !filters.includeTypes.has(event.type)) {
            return false;
        }
        if (filters.excludeTypes.has(event.type)) {
            return false;
        }
        if (filters.minDurationMs !== undefined && (event.durationMs ?? 0) < filters.minDurationMs) {
            return false;
        }
        return true;
    });
}

async function processFiles(parser: ApexLogParser, files: string[], options: CliOutputOptions): Promise<void> {
    const existingFiles: string[] = [];
    let hasErrors = false;

    for (const filePath of files) {
        // When there's only one file, we want to be more verbose on failure.
        const isSingleFile = files.length === 1;
        const valid = await verifyLogFile(filePath, isSingleFile);
        if (!valid) {
            if (path.extname(filePath) === '.log') hasErrors = true;
            continue;
        }
        existingFiles.push(filePath);
    }

    if (existingFiles.length === 0 && files.length > 0) {
        process.exit(1);
    }

    let successfulParses = 0;
    for (const filePath of existingFiles) {
        const result = await parseFile(parser, filePath, options);
        if (result.success) {
            outputResult(result.data, options);
            successfulParses++;
        } else {
            hasErrors = true;
        }
    }

    await new Promise(resolve => process.stdout.write('', resolve));

    if (successfulParses === 0 && files.length > 0) {
        process.exit(1); // Total failure
    } else if (hasErrors) {
        process.exit(2); // Partial success
    } else {
        process.exit(0); // Total success
    }
}

async function processStdin(parser: ApexLogParser, options: CliOutputOptions): Promise<void> {
    await processRawStdin(parser, options);
}

async function processRawStdin(parser: ApexLogParser, options: CliOutputOptions): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
    });

    let logCount = 0;
    let successfulParses = 0;
    const splitter = new ApexLogSplitter((logData: LogData) => {
        logCount++;
        const source = 'stdin: ' + logData.number;
        try {
            const apexLog = parser.parse(logData.log, source, { includeContext: options.includeContext || options.hotspots });
            outputResult(apexLog, options);
            successfulParses++;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Error parsing ${source}: ${message}`);
        }
    });

    rl.on('line', (line) => {
        line = cleanAnsiCodes(line);
        splitter.processLine(line);
    });

    rl.on('error', (err) => {
        console.error(`Error reading from stdin: ${err.message}`);
        process.exit(1);
    });

    rl.on('close', async () => {
        splitter.finalize();
        await new Promise(resolve => process.stdout.write('', resolve));

        if (logCount === 0) {
            console.error('No Apex log found in stdin. Expected a log header such as "64.0 APEX_CODE,FINEST;...".');
            process.exit(1);
        } else if (successfulParses === 0) {
            process.exit(1); // Total failure
        } else if (successfulParses < logCount) {
            process.exit(2); // Partial success
        } else {
            process.exit(0); // Total success
        }
    });
}

function parseNdjsonLine(line: string, lineNumber: number): NdjsonInput {
    let parsed: unknown;

    try {
        parsed = JSON.parse(line);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`NDJSON parse error on line ${lineNumber}: invalid JSON (${message})`, {
            cause: error,
        });
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`NDJSON parse error on line ${lineNumber}: expected a JSON object`);
    }

    const ndjsonInput = parsed as Partial<NdjsonInput>;
    const { Id, Log } = ndjsonInput;

    if (Id === undefined) {
        throw new Error(`NDJSON parse error on line ${lineNumber}: missing required field "Id"`);
    }
    if (typeof Id !== 'string') {
        throw new Error(`NDJSON parse error on line ${lineNumber}: field "Id" must be a string`);
    }
    if (Log === undefined) {
        throw new Error(`NDJSON parse error on line ${lineNumber}: missing required field "Log"`);
    }
    if (typeof Log !== 'string') {
        throw new Error(`NDJSON parse error on line ${lineNumber}: field "Log" must be a string`);
    }

    for (const fieldName of OPTIONAL_NDJSON_STRING_FIELDS) {
        const fieldValue = ndjsonInput[fieldName];
        if (fieldValue !== undefined && typeof fieldValue !== 'string') {
            throw new Error(`NDJSON parse error on line ${lineNumber}: field "${fieldName}" must be a string`);
        }
    }

    return ndjsonInput as NdjsonInput;
}

async function processNdjsonStdin(parser: ApexLogParser, options: CliOutputOptions): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
    });

    let lineNumber = 0;

    try {
        for await (const rawLine of rl) {
            lineNumber++;
            const line = cleanAnsiCodes(rawLine).trim();

            if (line.length === 0) {
                continue;
            }

            const { Id, Log, Request, Operation, LastModifiedDate, Status } = parseNdjsonLine(line, lineNumber);
            const apexLog = parser.parse(Log, Id, { includeContext: options.includeContext || options.hotspots });
            apexLog.summary.request = Request;
            apexLog.summary.operation = Operation;
            apexLog.summary.lastModifiedDate = LastModifiedDate;
            apexLog.summary.status = Status;
            outputResult(apexLog, options);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    }

    await new Promise(resolve => process.stdout.write('', resolve));
    process.exit(0);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const { files, tree, includeTree, includeContext, inputFormat, filters, nearLimit, nearLimitOptions, hotspots, top } = parseArgs(args);
    const outputOptions: CliOutputOptions = {
        tree,
        includeTree,
        includeContext,
        filters,
        nearLimit,
        nearLimitOptions,
        hotspots,
        top,
    };

    const parser = new ApexLogParser();

    if (files.length === 0) {
        if (process.stdin.isTTY) {
            console.error(HELP_TEXT);
            process.exit(1);
        }
        if (inputFormat === 'ndjson') {
            await processNdjsonStdin(parser, outputOptions);
        } else {
            await processStdin(parser, outputOptions);
        }
    } else {
        await processFiles(parser, files, outputOptions);
    }
}

main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Unexpected error: ${message}`);
    process.exit(1);
});
