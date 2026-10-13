import type {
    EventContext,
    EventContextFrame,
    EventNode,
    Hotspot,
    HotspotReport,
    HotspotSlowest,
    LimitDetail,
    LogLevel,
    NearLimitMatch,
    NearLimitReport,
    NearLimitTransaction,
    NodeType,
    ParsedLogSummary,
    PeakLimit,
    StackFrame,
    SummaryCounts,
    SummaryError,
    TransactionOutcome,
} from './types.js';
import { LIMIT_TYPES } from './NearLimitReport.js';
import type { PrunedTreeNode } from './TreePruner.js';

type JsonSchema = { [keyword: string]: unknown };

// hiddenChildren is only set for --tree rendering, never in JSON output.
type JsonTreeNode = Omit<PrunedTreeNode, 'hiddenChildren' | 'children'> & { children?: JsonTreeNode[] };

type DefaultJsonOutput = {
    summary: ParsedLogSummary;
    tree?: JsonTreeNode;
    events: EventNode[];
};

// The mapped property type forces every field of T to be described, so schema and types.ts cannot drift.
function objectSchema<T>(
    properties: { [K in keyof Required<T>]: JsonSchema },
    required: Array<keyof T & string>,
    description?: string,
): JsonSchema {
    return {
        type: 'object',
        ...(description ? { description } : {}),
        properties,
        required,
    };
}

const STRING = { type: 'string' };
const NUMBER = { type: 'number' };
const INTEGER = { type: 'integer' };

// Fails to compile when the listed values omit a member of T.
const exhaustive = <T extends string>() => <const L extends readonly T[]>(
    ...values: L & ([T] extends [L[number]] ? unknown : ['Missing member', Exclude<T, L[number]>])
): L => values;

const EVENT_TYPES = exhaustive<Exclude<NodeType, 'ROOT'>>()(
    'CODE_UNIT', 'METHOD', 'CONSTRUCTOR', 'SYSTEM_METHOD', 'SOQL', 'DML', 'EXCEPTION_THROWN', 'FATAL_ERROR',
    'EXECUTION', 'FLOW', 'FLOW_ELEMENT', 'FLOW_START_INTERVIEW', 'FLOW_BULK_ELEMENT', 'MANAGED_PKG', 'CALLOUT',
    'LIMIT', 'USER_DEBUG',
);

const OUTCOMES = exhaustive<TransactionOutcome>()('success', 'fatal');

const LOG_LEVEL_TYPES = exhaustive<LogLevel['type']>()(
    'APEX_CODE', 'APEX_PROFILING', 'CALLOUT', 'DATA_ACCESS', 'DB', 'NBA', 'SYSTEM', 'VALIDATION', 'VISUALFORCE',
    'WAVE', 'WORKFLOW',
);

const LOG_LEVELS = exhaustive<LogLevel['level']>()(
    'FINEST', 'FINER', 'FINE', 'INFO', 'INTERNAL', 'DEBUG', 'WARN', 'ERROR', 'FATAL',
);

const ref = (name: string): JsonSchema => ({ $ref: `#/$defs/${name}` });

const summarySchema = objectSchema<ParsedLogSummary>({
    source: STRING,
    user: STRING,
    startTime: { type: 'string', description: 'HH:MM:SS.mmm clock time of the first event' },
    request: STRING,
    operation: STRING,
    lastModifiedDate: STRING,
    status: STRING,
    durationMs: NUMBER,
    sizeMb: NUMBER,
    logLevels: {
        type: 'object',
        propertyNames: { enum: LOG_LEVEL_TYPES },
        additionalProperties: { enum: LOG_LEVELS },
    },
    outcome: { enum: OUTCOMES, description: "'fatal' when any FATAL_ERROR exists" },
    errors: { type: 'array', items: ref('SummaryError'), description: 'Omitted when there are no fatal errors' },
    peakLimits: {
        type: 'object',
        description: 'Worst LIMIT snapshot per limit type across namespaces and scopes',
        propertyNames: { enum: LIMIT_TYPES },
        additionalProperties: ref('PeakLimit'),
    },
    counts: ref('SummaryCounts'),
}, ['source', 'durationMs', 'sizeMb', 'logLevels', 'outcome', 'peakLimits', 'counts'],
'Triage fields (outcome, errors, peakLimits, counts) are computed from the full log and ignore filters');

const summaryErrorSchema = objectSchema<SummaryError>({
    eventId: STRING,
    exceptionType: STRING,
    message: STRING,
    lineNumber: INTEGER,
}, ['eventId', 'exceptionType', 'message']);

const peakLimitSchema = objectSchema<PeakLimit>({
    current: NUMBER,
    max: NUMBER,
    usagePercentage: NUMBER,
    namespace: STRING,
}, ['current', 'max', 'usagePercentage', 'namespace']);

const summaryCountsSchema = objectSchema<SummaryCounts>({
    soql: INTEGER,
    dml: INTEGER,
    callouts: INTEGER,
    exceptionsThrown: INTEGER,
    fatalErrors: { type: 'integer', description: 'Counted before deduplication' },
    userDebug: INTEGER,
}, ['soql', 'dml', 'callouts', 'exceptionsThrown', 'fatalErrors', 'userDebug']);

const limitDetailSchema = objectSchema<LimitDetail>({
    current: NUMBER,
    max: NUMBER,
    usagePercentage: NUMBER,
}, ['current', 'max', 'usagePercentage']);

const stackFrameSchema = objectSchema<StackFrame>({
    frame: { type: 'string', description: 'Apex frame such as Class.MyClass.method or Trigger.MyTrigger' },
    lineNumber: INTEGER,
    column: INTEGER,
}, ['frame']);

const contextFrameSchema = objectSchema<EventContextFrame>({
    id: STRING,
    type: { enum: EVENT_TYPES },
    name: STRING,
    lineNumber: INTEGER,
    operation: STRING,
    object: STRING,
    rows: INTEGER,
}, ['id', 'type']);

const contextSchema = objectSchema<EventContext>({
    stack: { type: 'array', items: ref('EventContextFrame') },
}, ['stack']);

const nodeProperties = {
    id: STRING,
    parentId: STRING,
    type: { enum: EVENT_TYPES },
    limits: {
        type: 'object',
        propertyNames: { enum: LIMIT_TYPES },
        additionalProperties: ref('LimitDetail'),
    },
    namespace: STRING,
    limitScope: { enum: ['cumulative', 'testing'] },
    request: STRING,
    response: STRING,
    namedCredentialRequest: STRING,
    namedCredentialResponse: STRING,
    namedCredentialResponseDetails: STRING,
    responseDetails: STRING,
    exceptionType: STRING,
    debugLevel: STRING,
    message: { type: 'string', description: 'USER_DEBUG text, or the exception message for FATAL_ERROR' },
    stackTrace: { type: 'array', items: ref('StackFrame'), description: 'FATAL_ERROR stack frames, innermost first' },
    name: STRING,
    method: STRING,
    lineNumber: INTEGER,
    query: STRING,
    object: STRING,
    rows: INTEGER,
    operation: STRING,
    timeStart: { type: 'integer', description: 'Nanoseconds since the start of the log' },
    timeEnd: INTEGER,
    durationMs: { type: 'number', description: 'Inclusive of children' },
    selfMs: { type: 'number', description: 'durationMs minus direct children durationMs, clamped at 0' },
    rowsReturned: INTEGER,
};

const eventSchema = objectSchema<EventNode>({
    ...nodeProperties,
    source: STRING,
    executionId: STRING,
    context: ref('EventContext'),
}, ['id', 'type', 'source']);

const treeNodeSchema = objectSchema<JsonTreeNode>({
    ...nodeProperties,
    type: { enum: ['ROOT', ...EVENT_TYPES] },
    children: { type: 'array', items: ref('TreeNode') },
    hiddenDescendants: {
        type: 'integer',
        description: 'With --max-depth, count of all pruned descendants on nodes at the depth limit; such nodes omit children',
    },
}, ['id', 'type']);

const nearLimitMatchSchema = objectSchema<NearLimitMatch>({
    scope: { enum: ['cumulative', 'testing'] },
    namespace: STRING,
    limit: { enum: LIMIT_TYPES },
    current: NUMBER,
    max: NUMBER,
    usagePercentage: NUMBER,
    breached: { type: 'boolean', description: 'True when current exceeds max' },
    threshold: { type: 'number', description: '100 when reported only because current reached max' },
    eventId: STRING,
    timeStart: INTEGER,
}, ['scope', 'namespace', 'limit', 'current', 'max', 'usagePercentage', 'breached', 'threshold', 'eventId', 'timeStart']);

const nearLimitTransactionSchema = objectSchema<NearLimitTransaction>({
    executionId: STRING,
    label: STRING,
    timeStart: INTEGER,
    timeEnd: INTEGER,
    durationMs: NUMBER,
    matches: { type: 'array', items: ref('NearLimitMatch') },
}, ['executionId', 'label', 'matches']);

const defaultOutputSchema = objectSchema<DefaultJsonOutput>({
    summary: ref('Summary'),
    events: { type: 'array', items: ref('Event') },
    tree: ref('TreeNode'),
}, ['summary', 'events'], 'Default output; tree is present only with --include-tree');

const nearLimitOutputSchema = objectSchema<NearLimitReport>({
    summary: ref('Summary'),
    nearLimitTransactions: { type: 'array', items: ref('NearLimitTransaction') },
}, ['summary', 'nearLimitTransactions'], 'Output of --near-limit');

const hotspotSlowestSchema = objectSchema<HotspotSlowest>({
    id: STRING,
    durationMs: NUMBER,
    selfMs: NUMBER,
    lineNumber: INTEGER,
    context: ref('EventContext'),
}, ['id'], 'Occurrence with the highest selfMs');

const hotspotSchema = objectSchema<Hotspot>({
    type: { enum: EVENT_TYPES },
    name: STRING,
    count: INTEGER,
    totalSelfMs: NUMBER,
    maxSelfMs: NUMBER,
    inclusiveMs: { type: 'number', description: 'Outermost occurrences only, so recursion is not double-counted' },
    slowest: ref('HotspotSlowest'),
}, ['type', 'count', 'totalSelfMs', 'maxSelfMs', 'inclusiveMs', 'slowest']);

const hotspotOutputSchema = objectSchema<HotspotReport>({
    summary: ref('Summary'),
    hotspots: { type: 'array', items: ref('Hotspot'), description: 'Sorted by totalSelfMs descending' },
}, ['summary', 'hotspots'], 'Output of --hotspots');

/**
 * JSON Schema for one JSON document printed per parsed log. Each document matches either
 * DefaultOutput, NearLimitOutput (--near-limit), or HotspotOutput (--hotspots).
 */
export const JSON_SCHEMA: JsonSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/PreziosiRaffaele/apex-log-parser/schema/output.json',
    title: 'apex-log-parser output',
    oneOf: [ref('DefaultOutput'), ref('NearLimitOutput'), ref('HotspotOutput')],
    $defs: {
        DefaultOutput: defaultOutputSchema,
        NearLimitOutput: nearLimitOutputSchema,
        HotspotOutput: hotspotOutputSchema,
        Summary: summarySchema,
        SummaryError: summaryErrorSchema,
        PeakLimit: peakLimitSchema,
        SummaryCounts: summaryCountsSchema,
        Event: eventSchema,
        TreeNode: treeNodeSchema,
        EventContext: contextSchema,
        EventContextFrame: contextFrameSchema,
        StackFrame: stackFrameSchema,
        LimitDetail: limitDetailSchema,
        NearLimitTransaction: nearLimitTransactionSchema,
        NearLimitMatch: nearLimitMatchSchema,
        Hotspot: hotspotSchema,
        HotspotSlowest: hotspotSlowestSchema,
    },
};
