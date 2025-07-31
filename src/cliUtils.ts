import ansiRegex from 'ansi-regex';
const regex = ansiRegex();

export function normalizeLogInput(logText: string): string {
    logText = cleanAnsiCodes(logText);
    logText = convertLiteralNewlinesToActual(logText);
    return logText;
}

function cleanAnsiCodes(logText: string): string {
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
