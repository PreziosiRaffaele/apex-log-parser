import * as fs from 'fs';
import * as path from 'path';
import { extractTimestamp, extractLineNumber, extractObject, extractRows } from './apexLogExtractors';

interface GovernorLimit {
    used: number;
    max: number;
}

interface GovernorLimits {
    [limitType: string]: GovernorLimit;
}

interface TreeNode {
    type: 'ROOT' | 'CODE UNIT' | 'METHOD' | 'SOQL' | 'DML' | 'EXCEPTION' | 'EXECUTION' | 'FLOW_INTERVIEW';
    context?: string;
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

interface LogLevel {
    type: 'APEX_CODE' | 'APEX_PROFILING' | 'CALLOUT' | 'DATA_ACCESS' | 'DB' | 'NBA' | 'SYSTEM' | 'VALIDATION' | 'VISUALFORCE' | 'WAVE' | 'WORKFLOW';
    level: 'FINEST' | 'FINER' | 'FINE' | 'INFO' | 'INTERNAL' | 'DEBUG' | 'WARN' | 'ERROR' | 'FATAL';
}

// Event node without the recursive "children" property
type EventNode = Omit<TreeNode, 'children'> & {
  source?: string; // Optional since single file parsing won't have it
};
interface ParsedLog {
    meta: {
        filename: string;
        durationMs: number;
    };
    logLevel: LogLevel[];
    user?: string;
    limits: GovernorLimits;
    tree?: TreeNode;
    // Flatten list of every event in the log without nested children
    events: EventNode[];
}


export class ApexLogParser {
    private limits: GovernorLimits = {};
    private user?: string;
    private meta: Record<string, string> = {};
    private currentNode!: TreeNode;
    private rootNode?: TreeNode;
    private nodeStack: TreeNode[] = [];
    private logLevels: LogLevel[] = [];

    private mapTypeByTypeExit: Map<string, string> = new Map([
        ['CODE_UNIT_FINISHED', 'CODE UNIT'],
        ['METHOD_EXIT', 'METHOD'],
        ['SOQL_EXECUTE_END', 'SOQL'],
        ['DML_END', 'DML'],
        ['EXECUTION_FINISHED', 'EXECUTION'],
        ['FLOW_START_INTERVIEW_END', 'FLOW_INTERVIEW'],
    ]);

    public constructor() {
        this.reset();
    }

    public async parseFile(filePath: string): Promise<ParsedLog> {
        if (!filePath) throw new Error('File path is required');
        if (!fs.existsSync(filePath)) throw new Error(`File ${filePath} does not exist`);
        this.reset();

        this.meta.filename = path.basename(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            this.parseLine(lines[i], i);
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
                durationMs 
            },
            logLevel: this.logLevels,
            user: this.user,
            limits: this.limits,
            tree: this.rootNode,
            events: this.rootNode ? this.flattenEvents(this.rootNode) : [],
        };

        return output;
    }


    private reset(): void {
        this.limits = {};
        this.meta = {};
        const rootNode: TreeNode = {
            type: 'ROOT',
        };

        this.rootNode = rootNode;
        this.currentNode = rootNode;
        this.nodeStack = [rootNode];
        this.user = undefined;
        this.logLevels = [];
    }

    private parseLine(line: string, lineNumber: number): void {
        if (lineNumber === 0) {
            this.handleDebugLevels(line);
            return;
        }

        const parts = line.split('|');
        if (parts.length < 2) return;

        const executionTimePart = parts[0];
        const timestamp = extractTimestamp(executionTimePart);
        const eventType = parts[1];
        const eventData: string[] = parts.slice(2);

        switch (eventType) {
            case 'USER_INFO':
                this.handleUserInfo(eventData);
                break;
            case 'CODE_UNIT_STARTED':
                this.handleCodeUnitStarted(timestamp, eventData);
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
            case 'FATAL_ERROR':
                this.handleFatalError(timestamp, eventData);
                break;
            default:
                break;
        }
    }

    private handleFatalError(timestamp: number, eventData: string[]): void {
        // Create an EXCEPTION node so that the fatal error is captured in the tree
        const node: TreeNode = {
            type: 'EXCEPTION',
            message: eventData[eventData.length - 1],
            timeStart: timestamp,
        };

        // Attach the exception node to the current context
        this.pushNode(node);

        // Unwind the node stack until we reach the surrounding CODE UNIT (or ROOT if
        // no code-unit context exists). This mirrors the behaviour of the Salesforce
        // log where a fatal error terminates the execution of the current method
        // chain.
        while (
            this.currentNode &&
            this.currentNode.type !== 'CODE UNIT' &&
            this.currentNode.type !== 'ROOT'
        ) {
            this.closeNode(timestamp);
        }
    }

    private handleFlowStartInterviewBegin(timestamp: number, eventData: string[]): void {
        const node: TreeNode = {
            type: 'FLOW_INTERVIEW',
            name: eventData[eventData.length - 1],
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
            type: 'EXECUTION',
            timeStart: timestamp,
            timeEnd: undefined,
            durationMs: undefined,
        };
        this.pushNode(node);
    }

    private handleDmlBegin(timestamp: number, eventData: string[]): void {
        const node: TreeNode = {
            type: 'DML',
            context: this.currentNode?.method ?? this.currentNode?.name ?? this.currentNode?.context,
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
            type: 'SOQL',
            context: this.currentNode?.method ?? this.currentNode?.name ?? this.currentNode?.context,
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
            type: 'CODE UNIT',
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
            type: 'METHOD',
            method: eventData[eventData.length - 1],
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

    private closeNode(timestamp: number): void {
        if (this.nodeStack.length === 0) return;

        const node = this.nodeStack.pop()!;
        node.timeEnd = timestamp;
        const rawDuration = node.timeStart ? timestamp - node.timeStart : 0;
        // Round duration to 3 decimal places
        node.durationMs = Math.round((rawDuration + Number.EPSILON) * 1000) / 1000;
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

        // Skip the synthetic ROOT node from the output array
        const events: EventNode[] = node.type === 'ROOT' ? [] : [eventWithoutChildren as EventNode];

        if (children?.length) {
            for (const child of children) {
                events.push(...this.flattenEvents(child));
            }
        }

        return events;
    }
}


export { ParsedLog };
