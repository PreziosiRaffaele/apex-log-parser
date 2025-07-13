#!/usr/bin/env node
import { ParsedLog, ApexLogParser } from './ApexLogParser.js';
import { promises as fs } from 'fs';
import * as path from 'path';

function parseArgs(args: string[]): string[] | null {
    const fIndex = args.indexOf('-f');
    if (fIndex < 0) return null;
    
    const files: string[] = [];
    for (let i = fIndex + 1; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('-')) break;
        files.push(arg);
    }
    
    return files.length > 0 ? files : null;
}

function showUsage(): never {
    console.error('Usage: apex-parser -f <file1> [file2] ...');
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
        const apexLog = await parser.parseFile(filePath);
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

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const files = parseArgs(args);
    
    if (!files) {
        showUsage();
    }
    
    const parser = new ApexLogParser();
    
    if (files.length === 1) {
        await processSingleFile(parser, files[0]);
    } else {
        await processMultipleFiles(parser, files);
    }
}

main().catch((err: any) => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
