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
    return logText.replace(regex, '');
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
    } catch (err: any) {
        console.error(`File not found: ${filePath}`);
        return false;
    }
}
