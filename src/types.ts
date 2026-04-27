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
  | "LIMIT";

export type ParseOptions = {
    includeContext?: boolean;
};

export interface LimitDetail {
  current: number;
  max: number;
  usagePercentage: number;
}

export type LimitsObject = Record<LimitType, LimitDetail>;

export interface TreeNode {
    id: string;
    parentId?: string;
    type: NodeType;
    limits?: LimitsObject;
    request?: string;
    response?: string;
    namedCredentialRequest?: string;
    namedCredentialResponse?: string;
    namedCredentialResponseDetails?: string;
    responseDetails?: string;
    exceptionType?: string;
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

export interface ParsedLogSummary {
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
