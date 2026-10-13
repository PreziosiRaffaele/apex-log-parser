import { LimitsObject, LimitType, LimitDetail } from './types.js';

/**
 * Utility functions for extracting values from Apex debug log lines.
 * These helpers are intentionally stateless and reusable across the code-base.
 */

/**
 * Description: return the timestamp
 * Example execution time part: "07:29:05.123 (813678225)" -> returns 813.678225
 */
export function extractTimestamp(executionTimePart: string): number {
    const start = executionTimePart.indexOf('(') + 1;
    const end = executionTimePart.indexOf(')');
    if (start <= 0 || end <= start) return 0;

    const timestampText = executionTimePart.substring(start, end).trim();
    const timestampNs = parseFloat(timestampText);

    return timestampNs;
}

/**
 * Extract the wall-clock timestamp prefix from a log line.
 * Example execution time part: "07:29:05.123 (813678225)" -> "07:29:05.123"
 */
export function extractClockTime(executionTimePart: string): string | undefined {
    const match = executionTimePart.match(/^(\d{2}:\d{2}:\d{2}\.\d+)/);
    return match?.[1];
}

export function convertNsToMs(timestampNs: number): number {
    return Number.isFinite(timestampNs) ? timestampNs / 1_000_000 : 0; // convert ns to ms
}

/**
 * Extract the line number from a section like "[12]".
 */
export function extractLineNumber(lineNumberPart: string): number {
    const start = lineNumberPart.indexOf('[') + 1;
    const end = lineNumberPart.indexOf(']');
    if (start <= 0 || end <= start) return 0;

    const lineNumberText = lineNumberPart.substring(start, end).trim();
    return Number(lineNumberText);
}

const FROM_CLAUSE = /\bfrom\s+(\w+)/iy;

/**
 * Extract the lowercased sObject name following the top-level FROM clause.
 * FROM keywords inside parenthesized subqueries or string literals are ignored.
 * Returns '' when the query has no top-level FROM.
 */
export function extractObject(soqlString: string): string {
    if (!soqlString || typeof soqlString !== 'string') {
        return '';
    }

    let depth = 0;
    let inString = false;
    for (let i = 0; i < soqlString.length; i++) {
        const char = soqlString[i];
        if (inString) {
            if (char === '\\') i++;
            else if (char === "'") inString = false;
            continue;
        }

        if (char === "'") {
            inString = true;
        } else if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth = Math.max(0, depth - 1);
        } else if (depth === 0 && (char === 'f' || char === 'F')) {
            FROM_CLAUSE.lastIndex = i;
            const match = FROM_CLAUSE.exec(soqlString);
            if (match) return match[1].toLowerCase();
        }
    }

    return '';
}



/**
 * Extract the number of rows from strings like "Rows: 5" or "@37:5".
 */
export function extractRows(rowsString: string): number {
    if (!rowsString || typeof rowsString !== 'string') {
        return 0;
    }

    const parts = rowsString.split(':');
    if (parts.length < 2) {
        return 0;
    }

    const parsed = parseInt(parts[1].trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function removeTrailingNewlines(str: string): string {
    return str.replace(/\n+$/, '').replace(/\r+$/, '');
}

/**
 * Salesforce writes '|' inside logged values as '&#124;' so it never collides with the field separator.
 * '&' itself is not escaped, so a literal '&#124;' in the original text is also decoded to '|'.
 */
export function decodeEscapedPipes(str: string): string {
    return str.replace(/&#124;/g, '|');
}

export function sanitizeString(str: string): string {
    return str.replace(/\n/g, ' ').replace(/\r/g, ' ').trim();
}

/**
 * Parses the governor limit usage information from a log string.
 * @param limitUsageString The string containing the governor limit usage.
 * @param timestamp The timestamp of the event.
 * @returns A complete NamespaceGovernorLimits object.
 */
export function parseGovernorLimits(limitUsageString: string): LimitsObject {
    const defaultLimitDetails: LimitDetail = {
        current: 0,
        max: 0,
        usagePercentage: 0,
    };
    const limitsObject: LimitsObject = {
        SOQL_QUERIES: defaultLimitDetails,
        SOQL_ROWS: defaultLimitDetails,
        SOSL_SEARCHES: defaultLimitDetails,
        DML_STATEMENTS: defaultLimitDetails,
        DML_ROWS: defaultLimitDetails,
        CPU_TIME: defaultLimitDetails,
        HEAP_SIZE: defaultLimitDetails,
        CALLOUTS: defaultLimitDetails,
        EMAIL_INVOCATIONS: defaultLimitDetails,
        FUTURE_CALLS: defaultLimitDetails,
        QUEUEABLE_JOBS: defaultLimitDetails,
        MOBILE_APEX_PUSH: defaultLimitDetails,
    };


    // Early return for invalid input
    if (!limitUsageString?.trim()) {
        return limitsObject;
    }

    const limitTypeByLogString: Partial<Record<string, LimitType>> = {
        'Number of SOQL queries': 'SOQL_QUERIES',
        'Number of query rows': 'SOQL_ROWS',
        'Number of SOSL queries': 'SOSL_SEARCHES',
        'Number of DML statements': 'DML_STATEMENTS',
        'Number of Publish Immediate DML': 'DML_STATEMENTS',
        'Number of DML rows': 'DML_ROWS',
        'Maximum CPU time': 'CPU_TIME',
        'Maximum heap size': 'HEAP_SIZE',
        'Number of callouts': 'CALLOUTS',
        'Number of Email Invocations': 'EMAIL_INVOCATIONS',
        'Number of future calls': 'FUTURE_CALLS',
        'Number of queueable jobs added to the queue': 'QUEUEABLE_JOBS',
        'Number of Mobile Apex push calls': 'MOBILE_APEX_PUSH',
    };

    const parseUsageLine = (line: string) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;

        const colonIndex = trimmedLine.indexOf(':');
        if (colonIndex === -1) return;

        const limitType = trimmedLine.substring(0, colonIndex).trim();
        const usageString = trimmedLine.substring(colonIndex + 1).trim();

        const outOfIndex = usageString.indexOf(' out of ');
        if (outOfIndex === -1) return;

        const current = parseInt(usageString.substring(0, outOfIndex).trim(), 10);
        const max = parseInt(usageString.substring(outOfIndex + 8).trim(), 10);

        // Skip if parsing failed
        if (isNaN(current) || isNaN(max)) return;

        const type = limitTypeByLogString[limitType];
        if (!type) return;

        limitsObject[type] = {
            current,
            max,
            usagePercentage: max > 0 ? Math.round((current / max) * 100) : 0,
        };
    };

    // Process each line
    limitUsageString
        .split(/\r?\n|\r/)
        .forEach(parseUsageLine);

    return limitsObject;
}
