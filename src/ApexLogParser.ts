import { removeTrailingNewlines, sanitizeString, extractTimestamp, extractLineNumber, covertNsToMs, extractObject, extractRows, parseGovernorLimits } from './ParserUtils.js';
import { IdGenerator } from './IdGenerator.js';
import { LogLevel, ParsedLog, TreeNode, EventNode } from './types.js';


export class ApexLogParser {
    private user?: string;
    private meta: Record<string, string> = {};
    private logSize?: number;
    private currentNode!: TreeNode;
    private rootNode?: TreeNode;
    private nodeStack: TreeNode[] = [];
    private logLevels: LogLevel[] = [];
    private idGenerator: IdGenerator = new IdGenerator();

    private mapTypeByTypeExit: Map<string, string> = new Map([
        ['CODE_UNIT_FINISHED', 'CODE_UNIT'],
        ['METHOD_EXIT', 'METHOD'],
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

    public parse(log: string, filename: string = 'stdin'): ParsedLog {
        this.reset();

        this.meta.filename = filename;
        this.logSize = Buffer.byteLength(log, 'utf8');

        const firstNewlineIndex = log.indexOf('\n');
        const firstLine = firstNewlineIndex !== -1 ? log.slice(0, firstNewlineIndex) : log;
        const restOfLog = firstNewlineIndex !== -1 ? log.slice(firstNewlineIndex + 1) : '';

        this.handleDebugLevels(firstLine);

        const logEvents = restOfLog.split(/(?=^\d{2}:\d{2}:\d{2}\.\d+(?: \(\d+\)\|)?)/m);

        for (let i = 0; i < logEvents.length; i++) {
            this.parseLine(removeTrailingNewlines(logEvents[i]));
        }

        return this.buildOutput();
    }

    private buildOutput(): ParsedLog {
        let durationMs = this.rootNode?.children?.reduce((acc, node) => acc + (node.durationMs ?? 0), 0) ?? 0;
        // Round duration to 3 decimal places
        durationMs = Math.round((durationMs + Number.EPSILON) * 1000) / 1000;

        const output: ParsedLog = {
            meta: {
                filename: this.meta.filename,
                durationMs,
                sizeMb: this.logSize ? parseFloat((this.logSize / (1000 * 1000)).toFixed(5)) : 0,
            },
            logLevel: this.logLevels,
            user: this.user,
            tree: this.rootNode,
            events: this.rootNode ? this.flattenEvents(this.rootNode) : [],
        };

        return output;
    }


    private reset(): void {
        this.meta = {};
        this.idGenerator.reset();
        const rootNode: TreeNode = {
            id: this.idGenerator.next(),
            type: 'ROOT',
        };

        this.rootNode = rootNode;
        this.currentNode = rootNode;
        this.nodeStack = [rootNode];
        this.user = undefined;
        this.logLevels = [];
    }

    private parseLine(line: string): void {
        const parts = line.split('|');
        if (parts.length < 2) return;

        const executionTimePart = parts[0];
        const timestamp = extractTimestamp(executionTimePart);
        const eventType = parts[1];
        const eventData: string[] = parts.slice(2);

        // Close the current node if it is a managed package and the event is no longer related to a managed package. 
        // This is necessary because the managed package doesn't have an explicit exit event.
        if (this.currentNode?.type === 'MANAGED_PKG' && (eventType !== 'ENTERING_MANAGED_PKG' || (eventType === 'ENTERING_MANAGED_PKG' && this.currentNode?.name !== eventData[eventData.length - 1]))) {
            this.closeNode(timestamp);
        }

        switch (eventType) {
            case 'USER_INFO':
                this.handleUserInfo(eventData);
                break;
            case 'CODE_UNIT_STARTED':
                this.handleCodeUnitStarted(timestamp, eventData);
                break;
            case 'LIMIT_USAGE_FOR_NS':
                this.handleLimitUsageForNs(timestamp, eventData);
                break;
            case 'CODE_UNIT_FINISHED':
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'METHOD_ENTRY':
                this.handleMethodEntry(timestamp, eventData);
                break;
            case 'METHOD_EXIT':
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'SOQL_EXECUTE_BEGIN':
                this.handleSoqlExecuteBegin(timestamp, eventData);
                break;
            case 'SOQL_EXECUTE_END':
                this.handleSOQLExit(timestamp, eventData);
                break;
            case 'DML_BEGIN':
                this.handleDmlBegin(timestamp, eventData);
                break;
            case 'DML_END':
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'EXECUTION_STARTED':
                this.handleExecutionStarted(timestamp);
                break;
            case 'EXECUTION_FINISHED':
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'FLOW_START_INTERVIEW_BEGIN':
                this.handleFlowStartInterviewBegin(timestamp, eventData);
                break;
            case 'FLOW_START_INTERVIEW_END':
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'FLOW_ELEMENT_BEGIN':
                this.handleFlowElementBegin(timestamp, eventData);
                break;
            case 'FLOW_ELEMENT_END':
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'FATAL_ERROR':
                this.handleFatalError(timestamp, eventData);
                break;
            case 'ENTERING_MANAGED_PKG':
                this.handleEnteringManagedPkg(timestamp, eventData);
                break;
            case 'CALLOUT_REQUEST':
                this.handleCalloutRequest(timestamp, eventData);
                break;
            case 'CALLOUT_RESPONSE':
                this.handleCalloutResponse(timestamp, eventData);
                break;
            case 'NAMED_CREDENTIAL_REQUEST':
                this.handleNamedCredentialRequest(eventData);
                break;
            case 'NAMED_CREDENTIAL_RESPONSE':
                this.handleNamedCredentialResponse(eventData);
                break;
            case 'NAMED_CREDENTIAL_RESPONSE_DETAIL':
                this.handleNamedCredentialResponseDetail(eventData);
                break;
            case 'FLOW_BULK_ELEMENT_BEGIN':
                this.handleFlowBulkElementStart(timestamp, eventData);
                break;
            case 'FLOW_BULK_ELEMENT_END':
                this.handleNodeExit(timestamp, eventType);
                break;
            case 'FLOW_START_INTERVIEWS_BEGIN':
                this.handleFlowStartInterviewsBegin(timestamp, eventData);
                break;
            case 'FLOW_START_INTERVIEWS_END':
                this.handleNodeExit(timestamp, eventType);
                break;
            default:
                break;
        }
    }

    private handleLimitUsageForNs(timestamp: number, eventData: string[]): void {
        const namespace = eventData[0].replace(/[()]/g, '');
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'LIMIT',
            name: namespace,
            limits: parseGovernorLimits(eventData[1]),
            timeStart: timestamp,
        };
        this.pushNode(node);
        this.closeNode();
    }

    private handleFlowElementBegin(timestamp: number, eventData: string[]): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'FLOW_ELEMENT',
            name: eventData[eventData.length - 2] + ' ' + eventData[eventData.length - 1],
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleFlowStartInterviewsBegin(timestamp: number, eventData: string[]): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'FLOW',
            name: eventData[eventData.length - 1],
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleFlowBulkElementStart(timestamp: number, eventData: string[]): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'FLOW_BULK_ELEMENT',
            name: eventData[eventData.length - 1],
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleNamedCredentialResponseDetail(eventData: string[]): void {
        if (this.currentNode.type === 'CALLOUT') {
            this.currentNode.namedCredentialResponseDetails = eventData[eventData.length - 1];
        }
    }

    private handleNamedCredentialRequest(eventData: string[]): void {
        if (this.currentNode.type === 'CALLOUT') {
            this.currentNode.namedCredentialRequest = eventData[eventData.length - 1];
        }
    }

    private handleNamedCredentialResponse(eventData: string[]): void {
        if (this.currentNode.type === 'CALLOUT') {
            this.currentNode.namedCredentialResponse = eventData[eventData.length - 1];
        }
    }

    private handleCalloutRequest(timestamp: number, eventData: string[]): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'CALLOUT',
            request: eventData[eventData.length - 1],
            response: undefined,
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleCalloutResponse(timestamp: number, eventData: string[]): void {
        if (this.currentNode?.type === 'CALLOUT') {
            this.currentNode.response = eventData[eventData.length - 1];
        }
        this.handleNodeExit(timestamp, 'CALLOUT_RESPONSE');
    }

    private handleEnteringManagedPkg(timestamp: number, eventData: string[]): void {
        if (this.currentNode.type === 'MANAGED_PKG') return;
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'MANAGED_PKG',
            name: eventData[eventData.length - 1],
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleFatalError(timestamp: number, eventData: string[]): void {
        // Create an EXCEPTION node so that the fatal error is captured in the tree
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'EXCEPTION',
            message: sanitizeString(eventData[eventData.length - 1]),
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

    private handleFlowStartInterviewBegin(timestamp: number, eventData: string[]): void {
        const flowName = eventData[eventData.length - 1];
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
                this.logLevels.push({ type, level } as LogLevel);
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

    private handleDmlBegin(timestamp: number, eventData: string[]): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'DML',
            lineNumber: extractLineNumber(eventData[0]),
            operation: eventData[eventData.length - 3].split(':')[1],
            object: eventData[eventData.length - 2].split(':')[1],
            rows: extractRows(eventData[eventData.length - 1]),
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleSOQLExit(timestamp: number, eventData: string[]): void {
        if (this.currentNode && this.currentNode.type === 'SOQL') {
            this.currentNode.rows = extractRows(eventData[eventData.length - 1]);
        }
        this.handleNodeExit(timestamp, 'SOQL_EXECUTE_END');
    }

    private handleSoqlExecuteBegin(timestamp: number, eventData: string[]): void {
        const query = eventData[eventData.length - 1];
        const object = extractObject(query);
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'SOQL',
            query,
            object,
            rows: undefined,
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleUserInfo(eventData: string[]): void {
        this.user = eventData[eventData.length - 3];
    }


    private handleCodeUnitStarted(timestamp: number, eventData: string[]): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'CODE_UNIT',
            name: eventData[eventData.length - 1],
            durationMs: undefined,
            timeStart: timestamp,
            // Predefine timeEnd and duration so they appear before children in JSON output
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleMethodEntry(timestamp: number, eventData: string[]): void {
        const node: TreeNode = {
            id: this.idGenerator.next(),
            parentId: this.currentNode.id,
            type: 'METHOD',
            name: eventData[eventData.length - 1],
            lineNumber: extractLineNumber(eventData[0]),
            durationMs: undefined,
            timeStart: timestamp,
            timeEnd: undefined,
        };
        this.pushNode(node);
    }

    private handleNodeExit(timestamp: number, type: string): void {
        if (this.nodeStack.length === 0) return;

        if (this.nodeStack[this.nodeStack.length - 1].type !== this.mapTypeByTypeExit.get(type)) {
            while (this.nodeStack.length > 0 && this.nodeStack[this.nodeStack.length - 1].type !== this.mapTypeByTypeExit.get(type)) {
                this.closeNode(timestamp);
            }
        }

        this.closeNode(timestamp);
    }

    private closeNode(timestamp?: number): void {
        if (this.nodeStack.length === 0) return;

        const node = this.nodeStack.pop()!;

        if (timestamp) {
            node.timeEnd = timestamp;
            const rawDuration = node.timeStart ? covertNsToMs(timestamp - node.timeStart) : 0;
            // Round duration to 3 decimal places
            node.durationMs = Math.round((rawDuration + Number.EPSILON) * 1000) / 1000;
        }
        this.currentNode = this.nodeStack[this.nodeStack.length - 1] ?? null;
    }

    private pushNode(node: TreeNode): void {
        if (!this.currentNode) return;

        this.currentNode.children = this.currentNode.children ?? [];
        this.currentNode.children.push(node);
        this.nodeStack.push(node);
        this.currentNode = node;
    }

    /**
     * Recursively flattens the event tree into a simple array without the `children` property.
     * The root node is excluded from the flattened list because it does not represent
     * a real event – it is only a container for the tree itself.
     */
    private flattenEvents(node: TreeNode): EventNode[] {
        const { children, ...eventWithoutChildren } = node;
        const eventNode: EventNode = eventWithoutChildren;
        eventNode.source = this.meta.filename;
        // Skip the synthetic ROOT node from the output array
        const events: EventNode[] = node.type === 'ROOT' ? [] : [eventNode];

        if (children?.length) {
            for (const child of children) {
                events.push(...this.flattenEvents(child));
            }
        }

        return events;
    }
}
