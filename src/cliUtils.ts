import ansiRegex from 'ansi-regex';
import { promises as fs } from 'fs';
const regex = ansiRegex();

export function normalizeLogInput(logText: string): string {
    logText = cleanAnsiCodes(logText);
    logText = convertLiteralNewlinesToActual(logText);
    return logText;
}

export function cleanAnsiCodes(logText: string): string {
    if (!logText) return '';
    // `sf apex get log` can nest escapes (e.g. "\x1b[\x1b[94m31m"), so one pass may expose a new sequence.
    let previous: string;
    do {
        previous = logText;
        logText = logText.replace(regex, '');
    } while (logText !== previous);
    return logText;
}


function convertLiteralNewlinesToActual(inputData: string): string {
    // Check if we have literal \n characters (from pipe)
    if (inputData.includes('\\n') && !inputData.replace(/\\n/g, '').includes('\n')) {
        return inputData.replace(/\\n/g, '\n');
    }
    return inputData;
}

export async function checkFileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        console.error(`File not found: ${filePath}`);
        return false;
    }
}
