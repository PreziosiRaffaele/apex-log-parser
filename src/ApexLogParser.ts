import { removeTrailingNewlines, sanitizeString, extractClockTime, extractTimestamp, extractLineNumber, convertNsToMs, extractObject, extractRows, parseGovernorLimits } from './ParserUtils.js';
import { IdGenerator } from './IdGenerator.js';
import { LogLevel, LogLevelsMap, ParsedLog, ParsedLogSummary, TreeNode, EventNode, ParseOptions, EventContextFrame, NodeType } from './types.js';

type ParserSummaryState = {
    source: string;
    user?: string;
    startTime?: string;
    logLevels: LogLevelsMap;
};

function createEmptySummaryState(): ParserSummaryState {
    return {
        source: '',
        logLevels: {},
    };
}

const CONTEXT_NODE_TYPES = new Set<NodeType>([
    'CODE_UNIT',
    'METHOD',
    'CONSTRUCTOR',
    'SYSTEM_METHOD',
    'DML',
    'FLOW',
    'FLOW_ELEMENT',
    'FLOW_START_INTERVIEW',
    'FLOW_BULK_ELEMENT',
    'MANAGED_PKG',
]);

function getPipeField(payload: string, fieldIndex: number): string {
    let fieldStart = 0;

    for (let i = 0; i < fieldIndex; i++) {
        const pipeIndex = payload.indexOf('|', fieldStart);
        if (pipeIndex === -1) return '';
        fieldStart = pipeIndex + 1;
    }

    const fieldEnd = payload.indexOf('|', fieldStart);
    return fieldEnd === -1
        ? payload.slice(fieldStart)
        : payload.slice(fieldStart, fieldEnd);
}

function getPipeFieldFromEnd(payload: string, offsetFromEnd: number): string {
    let fieldEnd = payload.length;

    for (let i = 0; i <= offsetFromEnd; i++) {
        const fieldStart = payload.lastIndexOf('|', fieldEnd - 1);

        if (i === offsetFromEnd) {
            return payload.slice(fieldStart + 1, fieldEnd);
        }

        if (fieldStart === -1) return '';
        fieldEnd = fieldStart;
    }

    return '';
}

function getColonValue(field: string): string | undefined {
    const colonIndex = field.indexOf(':');
    if (colonIndex === -1) return undefined;

    const nextColonIndex = field.indexOf(':', colonIndex + 1);
    return nextColonIndex === -1
        ? field.slice(colonIndex + 1)
        : field.slice(colonIndex + 1, nextColonIndex);
}


export class ApexLogParser {
    private summary: ParserSummaryState = createEmptySummaryState();
    private logSize?: number;
    private currentNode!: TreeNode;
    private rootNode?: TreeNode;
    private nodeStack: TreeNode[] = [];
    private idGenerator: IdGenerator = new IdGenerator();

    private mapTypeByTypeExit: Map<string, string> = new Map([
        ['CODE_UNIT_FINISHED', 'CODE_UNIT'],
        ['METHOD_EXIT', 'METHOD'],
        ['CONSTRUCTOR_EXIT', 'CONSTRUCTOR'],
        ['SYSTEM_METHOD_EXIT', 'SYSTEM_METHOD'],
        ['SOQL_EXECUTE_END', 'SOQL'],
        ['DML_END', 'DML'],
        ['EXECUTION_FINISHED', 'EXECUTION'],
        ['FLOW_START_INTERVIEW_END', 'FLOW_START_INTERVIEW'],
        ['FLOW_BULK_ELEMENT_END', 'FLOW_BULK_ELEMENT'],
        ['FLOW_START_INTERVIEWS_END', 'FLOW'],
        ['FLOW_ELEMENT_END', 'FLOW_ELEMENT'],
        ['CALLOUT_RESPONSE', 'CALLOUT'],
    ]);

    public constructor() {
        this.reset();
    }

    public parse(log: string, source: string = 'stdin', options: ParseOptions = {}): ParsedLog {
        this.reset();

        this.summary.source = source;
        this.logSize = Buffer.byteLength(log, 'utf8');

        const firstNewlineIndex = log.indexOf('\n');
        const firstLine = firstNewlineIndex !== -1 ? log.slice(0, firstNewlineIndex) : log;
        const restOfLog = firstNewlineIndex !== -1 ? log.slice(firstNewlineIndex + 1) : '';

        this.handleDebugLevels(firstLine);

        const logEvents = restOfLog.split(/(?=^\d{2}:\d{2}:\d{2}\.\d+(?: \(\d+\)\|)?)/m);

        for (let i = 0; i < logEvents.length; i++) {
            this.parseLine(removeTrailingNewlines(logEvents[i]));
        }

        return this.buildOutput(options);
    }

    private buildOutput(options: ParseOptions): ParsedLog {
        let durationMs = this.rootNode?.children?.reduce((acc, node) => acc + (node.durationMs ?? 0), 0) ?? 0;
        // Round duration to 3 decimal places
        durationMs = Math.round((durationMs + Number.EPSILON) * 1000) / 1000;

        const summary: ParsedLogSummary = {
            source: this.summary.source,
            user: this.summary.user,
            startTime: this.summary.startTime,
            durationMs,
            sizeMb: this.logSize ? parseFloat((this.logSize / (1000 * 1000)).toFixed(5)) : 0,
            logLevels: this.summary.logLevels,
        };

        const output: ParsedLog = {
            summary,
            tree: this.rootNode,
            events: this.rootNode ? this.flattenEvents(this.rootNode, options) : [],
        };

        return output;
    }


    private reset(): void {
        this.summary = createEmptySummaryState();
        this.idGenerator.reset();
        const rootNode: TreeNode = {
            id: this.idGenerator.next(),
            type: 'ROOT',
        };

        this.rootNode = rootNode;
        this.currentNode = rootNode;
        this.nodeStack = [rootNode];
    }

    private parseLine(line: string): void {
        const firstPipeIndex = line.indexOf('|');
        if (firstPipeIndex === -1) return;

        const secondPipeIndex = line.indexOf('|', firstPipeIndex + 1);
        const executionTimePart = line.slice(0, firstPipeIndex);
        if (!this.summary.startTime) {
            this.summary.startTime = extractClockTime(executionTimePart);
        }

        const eventType = secondPipeIndex === -1
            ? line.slice(firstPipeIndex + 1)
            : line.slice(firstPipeIndex + 1, secondPipeIndex);
        const eventPayload = secondPipeIndex === -1 ? '' : line.slice(secondPipeIndex + 1);
        let timestamp: number | undefined;

        // Close the current node if it is a managed package and the event is no longer related to a managed package. 
        // This is necessary because the managed package doesn't have an explicit exit event.
        if (this.currentNode?.type === 'MANAGED_PKG' && (eventType !== 'ENTERING_MANAGED_PKG' || this.currentNode?.name !== getPipeFieldFromEnd(eventPayload, 0))) {
            timestamp = extractTimestamp(executionTimePart);
            this.closeNode(timestamp);
        }

        switch (eventType) {
            case 'USER_INFO':
                this.handleUserInfo(eventPayload);
                break;
            case 'CODE_UNIT_STARTED':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleCodeUnitStarted(timestamp, eventPayload);
                break;
            case 'LIMIT_USAGE_FOR_NS':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleLimitUsageForNs(timestamp, eventPayload);
                break;
            case 'CODE_UNIT_FINISHED':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'METHOD_ENTRY':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleMethodEntry(timestamp, eventPayload);
                break;
            case 'METHOD_EXIT':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'CONSTRUCTOR_ENTRY':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleConstructorEntry(timestamp, eventPayload);
                break;
            case 'CONSTRUCTOR_EXIT':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'SYSTEM_METHOD_ENTRY':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleSystemMethodEntry(timestamp, eventPayload);
                break;
            case 'SYSTEM_METHOD_EXIT':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'SOQL_EXECUTE_BEGIN':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleSoqlExecuteBegin(timestamp, eventPayload);
                break;
            case 'SOQL_EXECUTE_END':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleSOQLExit(timestamp, eventPayload);
                break;
            case 'DML_BEGIN':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleDmlBegin(timestamp, eventPayload);
                break;
            case 'DML_END':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'EXECUTION_STARTED':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleExecutionStarted(timestamp);
                break;
            case 'EXECUTION_FINISHED':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'FLOW_START_INTERVIEW_BEGIN':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleFlowStartInterviewBegin(timestamp, eventPayload);
                break;
            case 'FLOW_START_INTERVIEW_END':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'FLOW_ELEMENT_BEGIN':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleFlowElementBegin(timestamp, eventPayload);
                break;
            case 'FLOW_ELEMENT_END':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'FATAL_ERROR':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleFatalError(timestamp, eventPayload);
                break;
            case 'EXCEPTION_THROWN':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleExceptionThrown(timestamp, eventPayload);
                break;
            case 'ENTERING_MANAGED_PKG':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleEnteringManagedPkg(timestamp, eventPayload);
                break;
            case 'CALLOUT_REQUEST':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleCalloutRequest(timestamp, eventPayload);
                break;
            case 'CALLOUT_RESPONSE':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleCalloutResponse(timestamp, eventPayload);
                break;
            case 'NAMED_CREDENTIAL_REQUEST':
                this.handleNamedCredentialRequest(eventPayload);
                break;
            case 'NAMED_CREDENTIAL_RESPONSE':
                this.handleNamedCredentialResponse(eventPayload);
                break;
            case 'NAMED_CREDENTIAL_RESPONSE_DETAIL':
                this.handleNamedCredentialResponseDetail(eventPayload);
                break;
            case 'FLOW_BULK_ELEMENT_BEGIN':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleFlowBulkElementStart(timestamp, eventPayload);
                break;
            case 'FLOW_BULK_ELEMENT_END':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'FLOW_START_INTERVIEWS_BEGIN':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleFlowStartInterviewsBegin(timestamp, eventPayload);
                break;
            case 'FLOW_START_INTERVIEWS_END':
                timestamp = timestamp ?? extractTimestamp(executionTimePart);
                this.handleNodeExit(timestamp, eventType);
                break;
            default:
                break;
        }
    }

    private handleLimitUsageForNs(timestamp: number, eventPayload: string): void {
        const namespace = getPipeField(eventPayload, 0).replace(/[()]/g, '');
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'LIMIT',
            name: namespace,
            limits: parseGovernorLimits(getPipeField(eventPayload, 1)),
            timeStart: timestamp,
        };
        this.pushNode(node);
        this.closeNode();
    }

    private handleFlowElementBegin(timestamp: number, eventPayload: string): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'FLOW_ELEMENT',
            name: getPipeFieldFromEnd(eventPayload, 1) + ' ' + getPipeFieldFromEnd(eventPayload, 0),
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleFlowStartInterviewsBegin(timestamp: number, eventPayload: string): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'FLOW',
            name: getPipeFieldFromEnd(eventPayload, 0),
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleFlowBulkElementStart(timestamp: number, eventPayload: string): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'FLOW_BULK_ELEMENT',
            name: getPipeFieldFromEnd(eventPayload, 0),
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleNamedCredentialResponseDetail(eventPayload: string): void {
        if (this.currentNode.type === 'CALLOUT') {
            this.currentNode.namedCredentialResponseDetails = getPipeFieldFromEnd(eventPayload, 0);
        }
    }

    private handleNamedCredentialRequest(eventPayload: string): void {
        if (this.currentNode.type === 'CALLOUT') {
            this.currentNode.namedCredentialRequest = getPipeFieldFromEnd(eventPayload, 0);
        }
    }

    private handleNamedCredentialResponse(eventPayload: string): void {
        if (this.currentNode.type === 'CALLOUT') {
            this.currentNode.namedCredentialResponse = getPipeFieldFromEnd(eventPayload, 0);
        }
    }

    private handleCalloutRequest(timestamp: number, eventPayload: string): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'CALLOUT',
            request: getPipeFieldFromEnd(eventPayload, 0),
            response: undefined,
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleCalloutResponse(timestamp: number, eventPayload: string): void {
        if (this.currentNode?.type === 'CALLOUT') {
            this.currentNode.response = getPipeFieldFromEnd(eventPayload, 0);
        }
        this.handleNodeExit(timestamp, 'CALLOUT_RESPONSE');
    }

    private handleEnteringManagedPkg(timestamp: number, eventPayload: string): void {
        if (this.currentNode.type === 'MANAGED_PKG') return;
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'MANAGED_PKG',
            name: getPipeFieldFromEnd(eventPayload, 0),
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleFatalError(timestamp: number, eventPayload: string): void {
        // Create an EXCEPTION node so that the fatal error is captured in the tree
        const exceptionMessage = sanitizeString(getPipeFieldFromEnd(eventPayload, 0));
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'FATAL_ERROR',
            name: exceptionMessage,
            exceptionType: exceptionMessage.substring(0, exceptionMessage.indexOf(':')),
            timeStart: timestamp,
        };

        // Attach the exception node to the current context
        this.pushNode(node);

        // Unwind the node stack until we reach the surrounding CODE_UNIT (or ROOT if
        // no code-unit context exists). This mirrors the behaviour of the Salesforce
        // log where a fatal error terminates the execution of the current method
        // chain.
        while (
            this.currentNode &&
            this.currentNode.type !== 'CODE_UNIT' &&
            this.currentNode.type !== 'ROOT'
        ) {
            this.closeNode(timestamp);
        }
    }

    private handleExceptionThrown(timestamp: number, eventPayload: string): void {
        // Create an EXCEPTION node for thrown (but potentially handled) exceptions
        const exceptionMessage = sanitizeString(getPipeFieldFromEnd(eventPayload, 0));
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'EXCEPTION_THROWN',
            name: exceptionMessage,
            exceptionType: exceptionMessage.substring(0, exceptionMessage.indexOf(':')),
            timeStart: timestamp,
        };

        // Push as an instantaneous event and immediately close it
        this.pushNode(node);
        this.closeNode(timestamp);
    }

    private handleFlowStartInterviewBegin(timestamp: number, eventPayload: string): void {
        const flowName = getPipeFieldFromEnd(eventPayload, 0);
        if (this.currentNode?.type === 'FLOW') {
            this.currentNode.name = flowName;
        }

        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'FLOW_START_INTERVIEW',
            name: flowName,
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleDebugLevels(line: string): void {
        // Example: 64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST;...
        const parts = line.split(' ');
        if (parts.length < 2) return;

        const levels = parts.slice(1).join(' ');
        const levelPairs = levels.split(';');
        for (const pair of levelPairs) {
            const [type, level] = pair.split(',');
            if (type && level) {
                this.summary.logLevels[type as LogLevel['type']] = level as LogLevel['level'];
            }
        }
    }

    private handleExecutionStarted(timestamp: number): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'EXECUTION',
            timeStart: timestamp,
            timeEnd: undefined,
            durationMs: undefined,
        };
        this.pushNode(node);
    }

    private handleDmlBegin(timestamp: number, eventPayload: string): void {
        const operation = getColonValue(getPipeFieldFromEnd(eventPayload, 2));
        const object = getColonValue(getPipeFieldFromEnd(eventPayload, 1));
        const rows = extractRows(getPipeFieldFromEnd(eventPayload, 0));
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'DML',
            name: `${operation} on ${object} (${rows} rows)`,
            lineNumber: extractLineNumber(getPipeField(eventPayload, 0)),
            operation,
            object,
            rows,
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleSOQLExit(timestamp: number, eventPayload: string): void {
        if (this.currentNode && this.currentNode.type === 'SOQL') {
            this.currentNode.rows = extractRows(getPipeFieldFromEnd(eventPayload, 0));
        }
        this.handleNodeExit(timestamp, 'SOQL_EXECUTE_END');
    }

    private handleSoqlExecuteBegin(timestamp: number, eventPayload: string): void {
        const query = getPipeFieldFromEnd(eventPayload, 0);
        const object = extractObject(query);
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'SOQL',
            name: `Query on ${object}`,
            query,
            object,
            rows: undefined,
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleUserInfo(eventPayload: string): void {
        this.summary.user = getPipeFieldFromEnd(eventPayload, 2);
    }


    private handleCodeUnitStarted(timestamp: number, eventPayload: string): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'CODE_UNIT',
            name: getPipeFieldFromEnd(eventPayload, 0),
            durationMs: undefined,
            timeStart: timestamp,
            // Predefine timeEnd and duration so they appear before children in JSON output
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleMethodEntry(timestamp: number, eventPayload: string): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'METHOD',
            name: getPipeFieldFromEnd(eventPayload, 0),
            lineNumber: extractLineNumber(getPipeField(eventPayload, 0)),
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleConstructorEntry(timestamp: number, eventPayload: string): void {
        const signature = getPipeFieldFromEnd(eventPayload, 1);
        const className = getPipeFieldFromEnd(eventPayload, 0);
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'CONSTRUCTOR',
            name: signature ? `${className}.${signature}` : className,
            lineNumber: extractLineNumber(getPipeField(eventPayload, 0)),
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleSystemMethodEntry(timestamp: number, eventPayload: string): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'SYSTEM_METHOD',
            name: getPipeFieldFromEnd(eventPayload, 0),
            lineNumber: extractLineNumber(getPipeField(eventPayload, 0)),
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleNodeExit(timestamp: number, type: string): void {
        if (this.nodeStack.length <= 1) return;

        const expectedType = this.mapTypeByTypeExit.get(type);

        if (this.nodeStack[this.nodeStack.length - 1].type !== expectedType) {
            while (this.nodeStack.length > 1 && this.nodeStack[this.nodeStack.length - 1].type !== expectedType) {
                this.closeNode(timestamp);
            }
        }

        if (this.nodeStack[this.nodeStack.length - 1].type !== expectedType) {
            return;
        }

        this.closeNode(timestamp);
    }

    private closeNode(timestamp?: number): void {
        if (this.nodeStack.length <= 1) return;

        const node = this.nodeStack.pop()!;

        if (timestamp) {
            node.timeEnd = timestamp;
            const rawDuration = node.timeStart ? convertNsToMs(timestamp - node.timeStart) : 0;
            // Round duration to 3 decimal places
            node.durationMs = Math.round((rawDuration + Number.EPSILON) * 1000) / 1000;
        }
        this.currentNode = this.nodeStack[this.nodeStack.length - 1];
    }

    private pushNode(node: TreeNode): void {
        if (!this.currentNode) return;

        this.currentNode.children = this.currentNode.children ?? [];
        this.currentNode.children.push(node);
        this.nodeStack.push(node);
        this.currentNode = node;
    }

    private flattenEvents(rootNode: TreeNode, options: ParseOptions): EventNode[] {
        const events: EventNode[] = [];
        const stack: Array<{ node: TreeNode; contextStack: EventContextFrame[]; executionId?: string }> = [
            { node: rootNode, contextStack: [] },
        ];

        while (stack.length > 0) {
            const { node, contextStack, executionId } = stack.pop()!;
            const { children, ...eventWithoutChildren } = node;
            const nodeExecutionId = node.type === 'EXECUTION' ? node.id : executionId;

            if (node.type !== 'ROOT') {
                const eventNode: EventNode = {
                    ...eventWithoutChildren,
                    source: this.summary.source,
                };

                if (nodeExecutionId) {
                    eventNode.executionId = nodeExecutionId;
                }

                if (options.includeContext) {
                    eventNode.context = {
                        stack: contextStack.map(frame => ({ ...frame })),
                    };
                }

                events.push(eventNode);
            }

            if (!children?.length) {
                continue;
            }

            const childContextStack = options.includeContext && CONTEXT_NODE_TYPES.has(node.type)
                ? [...contextStack, this.createContextFrame(node)]
                : contextStack;

            for (let i = children.length - 1; i >= 0; i--) {
                stack.push({ node: children[i], contextStack: childContextStack, executionId: nodeExecutionId });
            }
        }

        return events;
    }

    private createContextFrame(node: TreeNode): EventContextFrame {
        return {
            id: node.id,
            type: node.type,
            name: node.name,
            lineNumber: node.lineNumber,
            operation: node.operation,
            object: node.object,
            rows: node.rows,
        };
    }
}
