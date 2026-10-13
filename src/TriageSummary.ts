import { LIMIT_TYPES } from './NearLimitReport.js';
import { sanitizeString } from './ParserUtils.js';
import type { EventNode, LimitType, PeakLimit, SummaryCounts, SummaryError, TriageSummary } from './types.js';

/**
 * Derives triage fields from the complete, unfiltered event list in chronological order.
 */
export function buildTriageSummary(events: EventNode[]): TriageSummary {
    const counts: SummaryCounts = { soql: 0, dml: 0, callouts: 0, exceptionsThrown: 0, fatalErrors: 0, userDebug: 0 };
    const errors: SummaryError[] = [];
    const peakLimits: Partial<Record<LimitType, PeakLimit>> = {};

    for (const event of events) {
        switch (event.type) {
            case 'SOQL': counts.soql++; break;
            case 'DML': counts.dml++; break;
            case 'CALLOUT': counts.callouts++; break;
            case 'EXCEPTION_THROWN': counts.exceptionsThrown++; break;
            case 'USER_DEBUG': counts.userDebug++; break;
            case 'FATAL_ERROR': {
                counts.fatalErrors++;
                errors.push(toSummaryError(event));
                break;
            }
            case 'LIMIT':
                collectPeakLimits(event, peakLimits);
                break;
        }
    }

    return {
        outcome: counts.fatalErrors > 0 ? 'fatal' : 'success',
        ...(errors.length > 0 ? { errors } : {}),
        peakLimits,
        counts,
    };
}

function toSummaryError(event: EventNode): SummaryError {
    const exceptionType = event.exceptionType ?? '';
    const message = sanitizeString(event.message ?? '');
    const error: SummaryError = {
        eventId: event.id,
        exceptionType,
        message: exceptionType ? message.slice(exceptionType.length + 1).trim() : message,
    };
    const lineNumber = event.stackTrace?.find(frame => frame.lineNumber !== undefined)?.lineNumber;
    if (lineNumber !== undefined) error.lineNumber = lineNumber;

    return error;
}

function collectPeakLimits(event: EventNode, peakLimits: Partial<Record<LimitType, PeakLimit>>): void {
    if (!event.limits) return;

    for (const limit of LIMIT_TYPES) {
        const detail = event.limits[limit];
        if (!detail || detail.max <= 0 || detail.current <= 0) continue;

        const existing = peakLimits[limit];
        if (existing
            && (existing.usagePercentage > detail.usagePercentage
                || (existing.usagePercentage === detail.usagePercentage && existing.current >= detail.current))) {
            continue;
        }

        peakLimits[limit] = {
            current: detail.current,
            max: detail.max,
            usagePercentage: detail.usagePercentage,
            namespace: event.namespace?.trim() || 'default',
        };
    }
}
