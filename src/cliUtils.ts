import ansiRegex from 'ansi-regex';
import { promises as fs } from 'fs';
const regex = ansiRegex();
const MAX_ANSI_PASSES = 5;
// eslint-disable-next-line no-control-regex -- matches ESC/CSI introducers in ANSI escapes
const ANSI_INTRODUCERS = /[\u001B\u009B]/g;

export function normalizeLogInput(logText: string): string {
    logText = cleanAnsiCodes(logText);
    logText = convertLiteralNewlinesToActual(logText);
    return logText;
}

export function cleanAnsiCodes(logText: string): string {
    if (!logText) return '';
    // `sf apex get log` can nest escapes (e.g. "\x1b[\x1b[94m31m"), so one pass may expose a new sequence.
    // Passes are capped to stay linear on adversarial nesting; leftover introducers are dropped so no
    // control characters reach the output.
    for (let pass = 0; pass < MAX_ANSI_PASSES; pass++) {
        const cleaned = logText.replace(regex, '');
        if (cleaned === logText) return logText;
        logText = cleaned;
    }
    return logText.replace(ANSI_INTRODUCERS, '');
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
