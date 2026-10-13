import type {
    EventContext,
    EventContextFrame,
    EventNode,
    LimitDetail,
    LogLevel,
    NearLimitMatch,
    NearLimitReport,
    NearLimitTransaction,
    NodeType,
    ParsedLogSummary,
    StackFrame,
    TreeNode,
} from './types.js';
import { LIMIT_TYPES } from './NearLimitReport.js';

type JsonSchema = { [keyword: string]: unknown };

type DefaultJsonOutput = {
    summary: ParsedLogSummary;
    tree?: TreeNode;
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
}, ['source', 'durationMs', 'sizeMb', 'logLevels']);

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
    durationMs: NUMBER,
    rowsReturned: INTEGER,
};

const eventSchema = objectSchema<EventNode>({
    ...nodeProperties,
    source: STRING,
    executionId: STRING,
    context: ref('EventContext'),
}, ['id', 'type', 'source']);

const treeNodeSchema = objectSchema<TreeNode>({
    ...nodeProperties,
    type: { enum: ['ROOT', ...EVENT_TYPES] },
    children: { type: 'array', items: ref('TreeNode') },
}, ['id', 'type']);

const nearLimitMatchSchema = objectSchema<NearLimitMatch>({
    scope: { enum: ['cumulative', 'testing'] },
    namespace: STRING,
    limit: { enum: LIMIT_TYPES },
    current: NUMBER,
    max: NUMBER,
    usagePercentage: NUMBER,
    threshold: NUMBER,
    eventId: STRING,
    timeStart: INTEGER,
}, ['scope', 'namespace', 'limit', 'current', 'max', 'usagePercentage', 'threshold', 'eventId', 'timeStart']);

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

/**
 * JSON Schema for one JSON document printed per parsed log. Each document matches either
 * DefaultOutput or NearLimitOutput depending on whether --near-limit was used.
 */
export const JSON_SCHEMA: JsonSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/PreziosiRaffaele/apex-log-parser/schema/output.json',
    title: 'apex-log-parser output',
    oneOf: [ref('DefaultOutput'), ref('NearLimitOutput')],
    $defs: {
        DefaultOutput: defaultOutputSchema,
        NearLimitOutput: nearLimitOutputSchema,
        Summary: summarySchema,
        Event: eventSchema,
        TreeNode: treeNodeSchema,
        EventContext: contextSchema,
        EventContextFrame: contextFrameSchema,
        StackFrame: stackFrameSchema,
        LimitDetail: limitDetailSchema,
        NearLimitTransaction: nearLimitTransactionSchema,
        NearLimitMatch: nearLimitMatchSchema,
    },
};
