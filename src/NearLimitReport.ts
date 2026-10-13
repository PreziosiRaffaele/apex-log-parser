import type { EventNode, LimitType, NearLimitMatch, NearLimitReport, NearLimitTransaction, ParsedLog } from './types.js';

export const LIMIT_TYPES: readonly LimitType[] = [
    'SOQL_QUERIES',
    'SOQL_ROWS',
    'SOSL_SEARCHES',
    'DML_STATEMENTS',
    'DML_ROWS',
    'CPU_TIME',
    'HEAP_SIZE',
    'CALLOUTS',
    'EMAIL_INVOCATIONS',
    'FUTURE_CALLS',
    'QUEUEABLE_JOBS',
    'MOBILE_APEX_PUSH',
];

export const DEFAULT_NEAR_LIMIT_THRESHOLDS: ReadonlyMap<LimitType, number> = new Map<LimitType, number>([
    ['SOQL_QUERIES', 70],
    ['SOQL_ROWS', 70],
    ['SOSL_SEARCHES', 80],
    ['DML_STATEMENTS', 70],
    ['DML_ROWS', 70],
    ['CPU_TIME', 70],
    ['HEAP_SIZE', 70],
    ['CALLOUTS', 80],
    ['EMAIL_INVOCATIONS', 90],
    ['FUTURE_CALLS', 90],
]);

export type NearLimitOptions = {
    thresholds: ReadonlyMap<LimitType, number>;
    excludedLimits: ReadonlySet<LimitType>;
};

type TransactionBuilder = {
    executionId: string;
    label?: string;
    timeStart?: number;
    timeEnd?: number;
    durationMs?: number;
    matchesByKey: Map<string, NearLimitMatch>;
};

const UNKNOWN_EXECUTION_ID = 'unknown';
const BREACH_THRESHOLD = 100;

export function isLimitType(value: string): value is LimitType {
    return LIMIT_TYPES.includes(value as LimitType);
}

export function createDefaultNearLimitThresholds(): Map<LimitType, number> {
    return new Map(DEFAULT_NEAR_LIMIT_THRESHOLDS);
}

export function buildNearLimitReport(data: ParsedLog, options: NearLimitOptions): NearLimitReport | undefined {
    const transactions = collectTransactionMetadata(data.events);

    for (const event of data.events) {
        if (event.type !== 'LIMIT' || !event.limits) continue;

        const executionId = event.executionId ?? UNKNOWN_EXECUTION_ID;
        const transaction = getTransaction(transactions, executionId);
        const scope = event.limitScope ?? 'cumulative';
        const namespace = event.namespace?.trim() || 'default';

        for (const limit of LIMIT_TYPES) {
            if (options.excludedLimits.has(limit)) continue;

            const detail = event.limits[limit];
            if (!detail || detail.max <= 0) continue;

            // Without a configured threshold, only report limits actually reached (current >= max).
            const configured = options.thresholds.get(limit);
            if (configured === undefined ? detail.current < detail.max : detail.usagePercentage < configured) continue;
            const threshold = configured ?? BREACH_THRESHOLD;

            const match: NearLimitMatch = {
                scope,
                namespace,
                limit,
                current: detail.current,
                max: detail.max,
                usagePercentage: detail.usagePercentage,
                breached: detail.current > detail.max,
                threshold,
                eventId: event.id,
                timeStart: event.timeStart ?? 0,
            };
            const matchKey = createMatchKey(executionId, match);
            const existing = transaction.matchesByKey.get(matchKey);

            if (!existing || isBetterMatch(match, existing)) {
                transaction.matchesByKey.set(matchKey, match);
            }
        }
    }

    const nearLimitTransactions = Array.from(transactions.values())
        .filter(transaction => transaction.matchesByKey.size > 0)
        .map(createNearLimitTransaction);

    if (nearLimitTransactions.length === 0) {
        return undefined;
    }

    return {
        summary: data.summary,
        nearLimitTransactions,
    };
}

function collectTransactionMetadata(events: EventNode[]): Map<string, TransactionBuilder> {
    const transactions = new Map<string, TransactionBuilder>();

    for (const event of events) {
        if (event.type === 'EXECUTION') {
            const transaction = getTransaction(transactions, event.executionId ?? event.id);
            transaction.timeStart = event.timeStart;
            transaction.timeEnd = event.timeEnd;
            transaction.durationMs = event.durationMs;
            continue;
        }

        if (event.type !== 'CODE_UNIT') continue;

        const label = getMeaningfulCodeUnitLabel(event);
        if (!label) continue;

        const transaction = getTransaction(transactions, event.executionId ?? UNKNOWN_EXECUTION_ID);
        transaction.label = transaction.label ?? label;
    }

    return transactions;
}

function getTransaction(transactions: Map<string, TransactionBuilder>, executionId: string): TransactionBuilder {
    let transaction = transactions.get(executionId);

    if (!transaction) {
        transaction = {
            executionId,
            matchesByKey: new Map<string, NearLimitMatch>(),
        };
        transactions.set(executionId, transaction);
    }

    return transaction;
}

function getMeaningfulCodeUnitLabel(event: EventNode): string | undefined {
    const label = event.name?.trim();
    if (!label || label.toLowerCase() === 'null') return undefined;

    return label;
}

function createMatchKey(executionId: string, match: NearLimitMatch): string {
    return [executionId, match.scope, match.namespace, match.limit].join('\u0000');
}

function isBetterMatch(candidate: NearLimitMatch, existing: NearLimitMatch): boolean {
    if (candidate.usagePercentage !== existing.usagePercentage) {
        return candidate.usagePercentage > existing.usagePercentage;
    }
    if (candidate.current !== existing.current) {
        return candidate.current > existing.current;
    }

    return candidate.timeStart > existing.timeStart;
}

function createNearLimitTransaction(transaction: TransactionBuilder): NearLimitTransaction {
    return {
        executionId: transaction.executionId,
        label: transaction.label ?? `EXECUTION ${transaction.executionId}`,
        timeStart: transaction.timeStart,
        timeEnd: transaction.timeEnd,
        durationMs: transaction.durationMs,
        matches: Array.from(transaction.matchesByKey.values()).sort(compareMatches),
    };
}

function compareMatches(left: NearLimitMatch, right: NearLimitMatch): number {
    return right.usagePercentage - left.usagePercentage
        || right.current - left.current
        || right.timeStart - left.timeStart
        || left.scope.localeCompare(right.scope)
        || left.namespace.localeCompare(right.namespace)
        || left.limit.localeCompare(right.limit);
}
