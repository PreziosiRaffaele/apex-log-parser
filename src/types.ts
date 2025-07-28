
export interface GovernorLimit {
    used: number;
    max: number;
}

export interface GovernorLimits {
    [limitType: string]: GovernorLimit;
}

export interface TreeNode {
    id: string;
    parentId?: string;
    type: 'ROOT' | 'CODE UNIT' | 'METHOD' | 'SOQL' | 'DML' | 'EXCEPTION' | 'EXECUTION' | 'FLOW' | 'FLOW_ELEMENT' | 'FLOW_START_INTERVIEW' | 'FLOW_BULK_ELEMENT' | 'MANAGED_PKG' | 'CALLOUT';
    context?: string;
    request?: string;
    response?: string;
    namedCredentialRequest?: string;
    namedCredentialResponse?: string;
    namedCredentialResponseDetails?: string;
    responseDetails?: string;
    name?: string;
    method?: string;
    lineNumber?: number;
    query?: string;
    object?: string;
    rows?: number;
    operation?: string;
    message?: string;
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
    limits: GovernorLimits;
    tree?: TreeNode;
    // Flatten list of every event in the log without nested children
    events: EventNode[];
}
