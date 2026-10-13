export interface LimitDetail {
  current: number;
  max: number;
  usagePercentage: number;
}

export type LimitType = 
  | 'SOQL_QUERIES'
  | 'SOQL_ROWS' 
  | 'SOSL_SEARCHES'
  | 'DML_STATEMENTS'
  | 'DML_ROWS'
  | 'CPU_TIME'
  | 'HEAP_SIZE'
  | 'CALLOUTS'
  | 'EMAIL_INVOCATIONS'
  | 'FUTURE_CALLS'
  | 'QUEUEABLE_JOBS'
  | 'MOBILE_APEX_PUSH';

export type LimitScope = 'cumulative' | 'testing';

export type NodeType = 
  | 'ROOT'
  | 'CODE_UNIT'
  | 'METHOD'
  | 'CONSTRUCTOR'
  | 'SYSTEM_METHOD'
  | 'SOQL'
  | 'DML'
  | 'EXCEPTION_THROWN' // non-fatal, may be caught
  | 'FATAL_ERROR' // terminal failure
  | 'EXECUTION'
  | 'FLOW'
  | 'FLOW_ELEMENT'
  | 'FLOW_START_INTERVIEW'
  | 'FLOW_BULK_ELEMENT'
  | 'MANAGED_PKG'
  | 'CALLOUT'
  | 'LIMIT'
  | 'USER_DEBUG';

export type ParseOptions = {
    includeContext?: boolean;
};

export type LimitsObject = Record<LimitType, LimitDetail>;

export interface TreeNode {
    id: string;
    parentId?: string;
    type: NodeType;
    limits?: LimitsObject;
    namespace?: string;
    limitScope?: LimitScope;
    request?: string;
    response?: string;
    namedCredentialRequest?: string;
    namedCredentialResponse?: string;
    namedCredentialResponseDetails?: string;
    responseDetails?: string;
    exceptionType?: string;
    debugLevel?: string;
    message?: string;
    name?: string;
    method?: string;
    lineNumber?: number;
    query?: string;
    object?: string;
    rows?: number;
    operation?: string;
    timeStart?: number;
    timeEnd?: number;
    durationMs?: number;
    rowsReturned?: number;
    children?: TreeNode[];
}

export interface LogLevel {
    type: 'APEX_CODE' | 'APEX_PROFILING' | 'CALLOUT' | 'DATA_ACCESS' | 'DB' | 'NBA' | 'SYSTEM' | 'VALIDATION' | 'VISUALFORCE' | 'WAVE' | 'WORKFLOW';
    level: 'FINEST' | 'FINER' | 'FINE' | 'INFO' | 'INTERNAL' | 'DEBUG' | 'WARN' | 'ERROR' | 'FATAL';
}

export type LogLevelsMap = Partial<Record<LogLevel['type'], LogLevel['level']>>;

export interface ParsedLogSummary extends TriageSummary {
    source: string;
    user?: string;
    startTime?: string;
    request?: string;
    operation?: string;
    lastModifiedDate?: string;
    status?: string;
    durationMs: number;
    sizeMb: number;
    logLevels: LogLevelsMap;
}

export type TransactionOutcome = 'success' | 'fatal';

export interface SummaryError {
    eventId: string;
    exceptionType: string;
    message: string;
    lineNumber?: number;
}

export interface PeakLimit extends LimitDetail {
    namespace: string;
}

export interface SummaryCounts {
    soql: number;
    dml: number;
    callouts: number;
    exceptionsThrown: number;
    fatalErrors: number;
    userDebug: number;
}

/** Computed from the full log; CLI event filters never change these fields. */
export interface TriageSummary {
    outcome: TransactionOutcome;
    errors?: SummaryError[];
    peakLimits: Partial<Record<LimitType, PeakLimit>>;
    counts: SummaryCounts;
}

export type EventContextFrame = {
    id: string;
    type: NodeType;
    name?: string;
    lineNumber?: number;
    operation?: string;
    object?: string;
    rows?: number;
};

export type EventContext = {
    stack: EventContextFrame[];
};

// Event node without the recursive "children" property
export type EventNode = Omit<TreeNode, 'children'> & {
    source: string;
    executionId?: string;
    context?: EventContext;
};
export interface ParsedLog {
    summary: ParsedLogSummary;
    tree?: TreeNode;
    // Flatten list of every event in the log without nested children
    events: EventNode[];
}

export interface NearLimitMatch {
    scope: LimitScope;
    namespace: string;
    limit: LimitType;
    current: number;
    max: number;
    usagePercentage: number;
    threshold: number;
    eventId: string;
    timeStart: number;
}

export interface NearLimitTransaction {
    executionId: string;
    label: string;
    timeStart?: number;
    timeEnd?: number;
    durationMs?: number;
    matches: NearLimitMatch[];
}

export interface NearLimitReport {
    summary: ParsedLogSummary;
    nearLimitTransactions: NearLimitTransaction[];
}
