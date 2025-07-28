#!/usr/bin/env node
import { ApexLogParser, ParsedLog } from './index.js';
import { promises as fs, readFileSync } from 'fs';
import * as path from 'path';

/**
 * Parses the command line arguments and returns the list of files to process.
 * If no -f flag is provided, returns an empty array.
 * @param args The command line arguments.
 * @returns The list of files to process.
 */
function parseArgs(args: string[]): string[]{
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
  If a single log file is provided, the output is the full structured log.
  If multiple files are provided, the output is a JSON object with an 'events' array, where each event
  includes a 'source' property indicating the origin file.

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

async function checkFileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (err: any) {
        console.error(`File not found: ${filePath}`);
        return false;
    }
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

async function processSingleFile(parser: ApexLogParser, filePath: string): Promise<void> {
    // Verify file; exit on any invalid
    const valid = await verifyLogFile(filePath, true);
    if (!valid) process.exit(1);
    
    const result = await parseFile(parser, filePath);
    if (result.success) {
        console.log(JSON.stringify(result.data, null, 2));
    } else {
        process.exit(1);
    }
}

async function processMultipleFiles(parser: ApexLogParser, files: string[]): Promise<void> {
    // Check which files exist and process only those
    const existingFiles: string[] = [];
    let hasErrors = false;
    
    for (const filePath of files) {
        const valid = await verifyLogFile(filePath);
        if (!valid) {
            if (path.extname(filePath) === '.log') hasErrors = true;
            continue;
        }
        existingFiles.push(filePath);
    }
    
    // If no files exist, exit with error
    if (existingFiles.length === 0) {
        process.exit(1);
    }
    
    // Process files sequentially to avoid memory issues with large files
    const allEvents: any[] = [];
    for (const filePath of existingFiles) {
        const result = await parseFile(parser, filePath);
        if (result.success) {
            const events = result.data.events.map((event: any) => ({
                ...event,
                source: filePath
            }));
            allEvents.push(...events);
        } else {
            hasErrors = true;
        }
    }

    console.log(JSON.stringify({ events: allEvents }, null, 2));
    await new Promise(resolve => process.stdout.write('', resolve));
    process.exit(hasErrors ? 2 : 0);
}

async function processStdin(parser: ApexLogParser): Promise<void> {
    let logContent = '';
    process.stdin.on('readable', () => {
        let chunk;
        while (null !== (chunk = process.stdin.read())) {
            logContent += chunk;
        }
    });

    process.stdin.on('end', () => {
        try {
            if (logContent.length !== 0) {
                const apexLog = parser.parse(logContent);
                console.log(JSON.stringify(apexLog, null, 2));
            }
            process.exit(0);
        } catch (err: any) {
            console.error(`Error parsing from stdin: ${err.message}`);
            process.exit(1);
        }
    });

    process.stdin.on('error', (err) => {
        console.error(`Error reading from stdin: ${err.message}`);
        process.exit(1);
    });
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const files = parseArgs(args);
    
    const parser = new ApexLogParser();

    if (files.length === 0 ) {
        if (process.stdin.isTTY) {
            process.exit(0);
        }
        await processStdin(parser);
    } else if (files.length === 1) {
        await processSingleFile(parser, files[0]);
    } else {
        await processMultipleFiles(parser, files);
    }
}

main().catch((err: any) => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
