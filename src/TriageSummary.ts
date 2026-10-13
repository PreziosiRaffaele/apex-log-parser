import { LIMIT_TYPES } from './NearLimitReport.js';
import type { EventNode, LimitType, PeakLimit, SummaryCounts, SummaryError, TriageSummary } from './types.js';

// A sanitized FATAL_ERROR name is "<headline> <stack frame>...", each newline replaced by a space.
const STACK_TRACE_START = /\s+(?=(?:Class|Trigger)\.[\w.]+: line \d+, column \d+|AnonymousBlock: line \d+, column \d+|\(System Code\)|External entry point)/;
const STACK_FRAME_LINE = /: line (\d+), column \d+/;

/**
 * Derives triage fields from the complete, unfiltered event list in chronological order.
 * Identical consecutive FATAL_ERROR entries within one execution are collapsed because Salesforce logs them twice.
 */
export function buildTriageSummary(events: EventNode[]): TriageSummary {
    const counts: SummaryCounts = { soql: 0, dml: 0, callouts: 0, exceptionsThrown: 0, fatalErrors: 0, userDebug: 0 };
    const errors: SummaryError[] = [];
    const peakLimits: Partial<Record<LimitType, PeakLimit>> = {};
    let previousFatal: EventNode | undefined;

    for (const event of events) {
        switch (event.type) {
            case 'SOQL': counts.soql++; break;
            case 'DML': counts.dml++; break;
            case 'CALLOUT': counts.callouts++; break;
            case 'EXCEPTION_THROWN': counts.exceptionsThrown++; break;
            case 'USER_DEBUG': counts.userDebug++; break;
            case 'FATAL_ERROR': {
                counts.fatalErrors++;
                const error = toSummaryError(event);
                if (!previousFatal || previousFatal.executionId !== event.executionId
                    || !isSameError(errors[errors.length - 1], error)) {
                    errors.push(error);
                }
                previousFatal = event;
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
    const text = event.name ?? '';
    const stackStart = text.search(STACK_TRACE_START);
    const headline = stackStart === -1 ? text : text.slice(0, stackStart);
    const stackTrace = stackStart === -1 ? '' : text.slice(stackStart);
    const colon = headline.indexOf(':');
    const exceptionType = colon === -1 ? '' : headline.slice(0, colon).trim();
    const message = (colon === -1 ? headline : headline.slice(colon + 1)).trim();

    const error: SummaryError = { eventId: event.id, exceptionType, message };
    const lineMatch = STACK_FRAME_LINE.exec(stackTrace);
    if (lineMatch) error.lineNumber = Number(lineMatch[1]);

    return error;
}

function isSameError(left: SummaryError, right: SummaryError): boolean {
    return left.exceptionType === right.exceptionType
        && left.message === right.message
        && left.lineNumber === right.lineNumber;
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
