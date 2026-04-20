#!/usr/bin/env node
import readline from 'readline';
import { ApexLogParser, ParsedLog } from './index.js';
import { ApexLogSplitter, LogData } from './ApexLogSplitter.js';
import { HELP_TEXT, SCHEMA_TEXT } from './cliText.js';
import { TreeRenderer } from './TreeRenderer.js';
import { checkFileExists, cleanAnsiCodes } from './cliUtils.js';
import { promises as fs, readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseNodeArgs } from 'node:util';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ParsedArgs = {
    files: string[];
    tree: boolean;
    inputFormat: 'raw' | 'ndjson';
}

type NdjsonInput = {
    Id: string;
    Log: string;
    Request?: string;
    Operation?: string;
    LastModifiedDate?: string;
    Status?: string;
};

const OPTIONAL_NDJSON_STRING_FIELDS = ['Request', 'Operation', 'LastModifiedDate', 'Status'] as const;

/**
 * Parses the command line arguments and returns the parsed arguments.
 * @param args The command line arguments.
 * @returns The parsed arguments including files and tree flag.
 */
function parseArgs(args: string[]): ParsedArgs {
    try {
        const { values } = parseNodeArgs({
            args,
            allowPositionals: true,
            strict: true,
            options: {
                help: { type: 'boolean', short: 'h' },
                version: { type: 'boolean', short: 'v' },
                schema: { type: 'boolean' },
                tree: { type: 'boolean' },
                'input-format': { type: 'string' },
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

        const files: string[] = [];
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg !== '-f') continue;

            for (let j = i + 1; j < args.length; j++) {
                const fileArg = args[j];
                if (fileArg.startsWith('-')) break;
                files.push(fileArg);
                i = j;
            }
        }

        return {
            files,
            tree: values.tree ?? false,
            inputFormat: inputFormatValue ?? 'raw',
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    }
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

async function parseFile(parser: ApexLogParser, filePath: string): Promise<{ success: true; data: ParsedLog } | { success: false; error: string }> {
    try {
        const logContent = await fs.readFile(filePath, 'utf-8');
        const apexLog = parser.parse(logContent, path.basename(filePath));
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

function outputResult(data: ParsedLog, useTree: boolean): void {
    if (useTree) {
        console.log(new TreeRenderer().renderTree(data));
    } else {
        console.log(JSON.stringify(data, null, 2));
    }
}

async function processFiles(parser: ApexLogParser, files: string[], tree: boolean): Promise<void> {
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
        const result = await parseFile(parser, filePath);
        if (result.success) {
            outputResult(result.data, tree);
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

async function processStdin(parser: ApexLogParser, tree: boolean): Promise<void> {
    await processRawStdin(parser, tree);
}

async function processRawStdin(parser: ApexLogParser, tree: boolean): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
    });

    const splitter = new ApexLogSplitter((logData: LogData) => {
        const apexLog = parser.parse(logData.log, 'stdin: ' + logData.number);
        outputResult(apexLog, tree);
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
        process.exit(0);
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

async function processNdjsonStdin(parser: ApexLogParser, tree: boolean): Promise<void> {
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
            const apexLog = parser.parse(Log, Id);
            apexLog.summary.request = Request;
            apexLog.summary.operation = Operation;
            apexLog.summary.lastModifiedDate = LastModifiedDate;
            apexLog.summary.status = Status;
            outputResult(apexLog, tree);
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
    const { files, tree, inputFormat } = parseArgs(args);

    const parser = new ApexLogParser();

    if (files.length === 0) {
        if (process.stdin.isTTY) {
            process.exit(0);
        }
        if (inputFormat === 'ndjson') {
            await processNdjsonStdin(parser, tree);
        } else {
            await processStdin(parser, tree);
        }
    } else {
        await processFiles(parser, files, tree);
    }
}

main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Unexpected error: ${message}`);
    process.exit(1);
});
