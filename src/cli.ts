#!/usr/bin/env node
import readline from 'readline';
import { ApexLogParser, ParsedLog } from './index.js';
import { ApexLogSplitter, LogData } from './ApexLogSplitter.js';
import { checkFileExists, cleanAnsiCodes } from './cliUtils.js';
import { promises as fs, readFileSync } from 'fs';
import * as path from 'path';

/**
 * Parses the command line arguments and returns the list of files to process.
 * If no -f flag is provided, returns an empty array.
 * @param args The command line arguments.
 * @returns The list of files to process.
 */
function parseArgs(args: string[]): string[] {
    if (args.indexOf('-h') !== -1 || args.indexOf('--help') !== -1) showUsage();
    if (args.indexOf('-v') !== -1 || args.indexOf('--version') !== -1) showVersion();
    const fIndex = args.indexOf('-f');
    if (fIndex === -1) return [];

    const files: string[] = [];
    for (let i = fIndex + 1; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('-')) break;
        files.push(arg);
    }

    return files;
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
Usage: apex-log-parser [-f <file1> [file2] ...]

Description:
  Parses one or more Apex log files and outputs the structured log data as JSON.
  If no file is specified, the parser reads from stdin.

Options:
  -f <file1> [file2] ...  Specifies one or more Apex log files to parse.
                          Multiple files can be provided, separated by spaces.
                          Only files with a '.log' extension will be processed.

Examples:
  Parse a single log file:
    apex-log-parser -f mylog.log

  Parse multiple log files:
    apex-log-parser -f log1.log log2.log log3.log

  Parse from stdin:
    sf apex get log --number 1 -o MyOrg | apex-log-parser
`);
    process.exit(1);
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

async function processFiles(parser: ApexLogParser, files: string[]): Promise<void> {
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
            console.log(JSON.stringify(result.data, null, 2));
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

async function processStdin(parser: ApexLogParser): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
    });

    const splitter = new ApexLogSplitter((logData: LogData) => {
        const apexLog = parser.parse(logData.log, 'stdin: ' + logData.number);
        console.log(JSON.stringify(apexLog, null, 2));
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
    const files = parseArgs(args);

    const parser = new ApexLogParser();

    if (files.length === 0) {
        if (process.stdin.isTTY) {
            process.exit(0);
        }
        await processStdin(parser);
    } else {
        await processFiles(parser, files);
    }
}

main().catch((err: any) => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
