#!/usr/bin/env node
import readline from 'readline';
import { ApexLogParser, ParsedLog } from './index.js';
import { ApexLogSplitter, LogData } from './ApexLogSplitter.js';
import { TreeRenderer } from './TreeRenderer.js';
import { checkFileExists, cleanAnsiCodes } from './cliUtils.js';
import { promises as fs, readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ParsedArgs = {
    files: string[];
    tree: boolean;
}

/**
 * Parses the command line arguments and returns the parsed arguments.
 * @param args The command line arguments.
 * @returns The parsed arguments including files and tree flag.
 */
function parseArgs(args: string[]): ParsedArgs {
    if (args.indexOf('-h') !== -1 || args.indexOf('--help') !== -1) showUsage();
    if (args.indexOf('-v') !== -1 || args.indexOf('--version') !== -1) showVersion();

    const tree = args.indexOf('--tree') !== -1;
    const fIndex = args.indexOf('-f');

    const files: string[] = [];
    if (fIndex !== -1) {
        for (let i = fIndex + 1; i < args.length; i++) {
            const arg = args[i];
            if (arg.startsWith('-')) break;
            files.push(arg);
        }
    }

    return { files, tree };
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
    console.error(`
Usage: apex-log-parser [-f <file1> [file2] ...] [--tree]

Description:
  Parses one or more Apex log files and outputs the structured log data as JSON.
  If no file is specified, the parser reads from stdin.

Options:
  -f <file1> [file2] ...  Specifies one or more Apex log files to parse.
                          Multiple files can be provided, separated by spaces.
                          Only files with a '.log' extension will be processed.
  --tree                  Output the parsed log in tree format instead of JSON.

Examples:
  Parse a single log file:
    apex-log-parser -f mylog.log

  Parse multiple log files:
    apex-log-parser -f log1.log log2.log log3.log

  Parse from stdin:
    sf apex get log --number 1 -o MyOrg | apex-log-parser

  Output in tree format:
    apex-log-parser -f mylog.log --tree
`);
    process.exit(0);
}

async function parseFile(parser: ApexLogParser, filePath: string): Promise<{ success: true; data: ParsedLog } | { success: false; error: string }> {
    try {
        const logContent = await fs.readFile(filePath, 'utf-8');
        const apexLog = parser.parse(logContent, path.basename(filePath));
        return { success: true, data: apexLog };
    } catch (err: any) {
        console.error(`Error parsing ${filePath}: ${err.message}`);
        return { success: false, error: err.message };
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
    } catch (err: any) {
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

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const { files, tree } = parseArgs(args);

    const parser = new ApexLogParser();

    if (files.length === 0) {
        if (process.stdin.isTTY) {
            process.exit(0);
        }
        await processStdin(parser, tree);
    } else {
        await processFiles(parser, files, tree);
    }
}

main().catch((err: any) => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
