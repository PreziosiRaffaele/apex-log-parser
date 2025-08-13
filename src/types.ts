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
  | 'SOQL'
  | 'DML'
  | 'EXCEPTION'
  | 'EXECUTION'
  | 'FLOW'
  | 'FLOW_ELEMENT'
  | 'FLOW_START_INTERVIEW'
  | 'FLOW_BULK_ELEMENT'
  | 'MANAGED_PKG'
  | 'CALLOUT'
  | "LIMIT";

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

// Event node without the recursive "children" property
export type EventNode = Omit<TreeNode, 'children'> & {
    source?: string; // Optional since single file parsing won't have it
};
export interface ParsedLog {
    meta: {
        filename: string;
        durationMs: number;
        sizeMb: number;
    };
    logLevel: LogLevel[];
    user?: string;
    tree?: TreeNode;
    // Flatten list of every event in the log without nested children
    events: EventNode[];
}
