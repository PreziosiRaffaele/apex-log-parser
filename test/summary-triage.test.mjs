import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ApexLogParser } from '../dist/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = resolve(repoRoot, 'dist/cli.js');

const fatalLog = [
    '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
    '09:00:00.0 (1000000)|EXECUTION_STARTED',
    '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.run()',
    '09:00:00.0 (3000000)|SOQL_EXECUTE_BEGIN|[5]|Aggregations:0|SELECT Id FROM Account',
    '09:00:00.0 (4000000)|SOQL_EXECUTE_END|[5]|Rows:1',
    '09:00:00.0 (5000000)|SOQL_EXECUTE_BEGIN|[6]|Aggregations:0|SELECT Id FROM Contact',
    '09:00:00.0 (6000000)|SOQL_EXECUTE_END|[6]|Rows:0',
    '09:00:00.0 (7000000)|DML_BEGIN|[8]|Op:Insert|Type:Account|Rows:1',
    '09:00:00.0 (8000000)|DML_END|[8]',
    '09:00:00.0 (9000000)|CALLOUT_REQUEST|[9]|System.HttpRequest[Endpoint=https://example.test]',
    '09:00:00.0 (10000000)|CALLOUT_RESPONSE|[9]|System.HttpResponse[Status=OK, StatusCode=200]',
    '09:00:00.0 (11000000)|USER_DEBUG|[10]|DEBUG|hello',
    '09:00:00.0 (12000000)|EXCEPTION_THROWN|[12]|System.NullPointerException: Attempt to de-reference a null object',
    '09:00:00.0 (13000000)|EXCEPTION_THROWN|[42]|System.LimitException: Too many queueable jobs added to the queue: 2',
    '09:00:00.0 (14000000)|FATAL_ERROR|System.LimitException: Too many queueable jobs added to the queue: 2',
    '',
    'Class.Test.enqueue: line 42, column 1',
    'Class.Test.run: line 7, column 1',
    '09:00:00.0 (15000000)|FATAL_ERROR|System.LimitException: Too many queueable jobs added to the queue: 2',
    '',
    'Class.Test.enqueue: line 42, column 1',
    'Class.Test.run: line 7, column 1',
    '09:00:00.0 (16000000)|CUMULATIVE_LIMIT_USAGE',
    '09:00:00.0 (17000000)|LIMIT_USAGE_FOR_NS|(default)|',
    '  Number of SOQL queries: 2 out of 100',
    '  Number of DML statements: 1 out of 150',
    '  Number of callouts: 0 out of 100',
    '  Number of queueable jobs added to the queue: 2 out of 1',
    '09:00:00.0 (18000000)|LIMIT_USAGE_FOR_NS|pkg|',
    '  Number of SOQL queries: 2 out of 100',
    '  Maximum CPU time: 150 out of 10000',
    '09:00:00.0 (19000000)|LIMIT_USAGE_FOR_NS|other|',
    '  Number of SOQL queries: 40 out of 100',
    '09:00:00.0 (20000000)|CUMULATIVE_LIMIT_USAGE_END',
    '09:00:00.0 (21000000)|CODE_UNIT_FINISHED|Class.Test.run()',
    '09:00:00.0 (22000000)|EXECUTION_FINISHED',
].join('\n');

const successLog = [
    '64.0 APEX_CODE,FINEST',
    '09:00:00.0 (1000000)|EXECUTION_STARTED',
    '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.quiet()',
    '09:00:00.0 (3000000)|CODE_UNIT_FINISHED|Class.Test.quiet()',
    '09:00:00.0 (4000000)|EXECUTION_FINISHED',
].join('\n');

function runCli(args, input = fatalLog) {
    const result = spawnSync(process.execPath, [cliPath, ...args], { input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

test('summary reports fatal outcome with deduplicated errors, peak limits, and counts', () => {
    const { summary } = new ApexLogParser().parse(fatalLog, 'fatal.log');

    assert.equal(summary.outcome, 'fatal');
    assert.equal(summary.errors.length, 1);
    assert.deepEqual(summary.errors[0], {
        eventId: summary.errors[0].eventId,
        exceptionType: 'System.LimitException',
        message: 'Too many queueable jobs added to the queue: 2',
        lineNumber: 42,
    });
    assert.deepEqual(summary.peakLimits, {
        SOQL_QUERIES: { current: 40, max: 100, usagePercentage: 40, namespace: 'other' },
        DML_STATEMENTS: { current: 1, max: 150, usagePercentage: 1, namespace: 'default' },
        CPU_TIME: { current: 150, max: 10000, usagePercentage: 2, namespace: 'pkg' },
        QUEUEABLE_JOBS: { current: 2, max: 1, usagePercentage: 200, namespace: 'default' },
    });
    assert.deepEqual(summary.counts, {
        soql: 2,
        dml: 1,
        callouts: 1,
        exceptionsThrown: 2,
        fatalErrors: 1,
        userDebug: 1,
    });
});

test('summary errors keep distinct non-consecutive fatal errors', () => {
    const log = fatalLog.replace(
        '09:00:00.0 (15000000)|FATAL_ERROR|System.LimitException: Too many queueable jobs added to the queue: 2',
        '09:00:00.0 (15000000)|FATAL_ERROR|System.DmlException: Insert failed',
    );
    const { summary } = new ApexLogParser().parse(log, 'fatal.log');

    assert.deepEqual(
        summary.errors.map(error => [error.exceptionType, error.message]),
        [
            ['System.LimitException', 'Too many queueable jobs added to the queue: 2'],
            ['System.DmlException', 'Insert failed'],
        ],
    );
});

test('summary reports success and omits errors when no FATAL_ERROR exists', () => {
    const { summary } = runCli([], successLog);

    assert.equal(summary.outcome, 'success');
    assert.equal('errors' in summary, false);
    assert.deepEqual(summary.peakLimits, {});
    assert.deepEqual(summary.counts, { soql: 0, dml: 0, callouts: 0, exceptionsThrown: 0, fatalErrors: 0, userDebug: 0 });
});

test('event filters do not change triage summary fields', () => {
    const unfiltered = runCli([]);
    const filtered = runCli(['--type', 'USER_DEBUG']);

    assert.equal(filtered.events.length, 1);
    assert.deepEqual(filtered.summary, unfiltered.summary);
});

test('--near-limit output carries triage summary fields', () => {
    const report = runCli(['--near-limit', '--limit-threshold', 'QUEUEABLE_JOBS=100']);

    assert.equal(report.summary.outcome, 'fatal');
    assert.equal(report.summary.counts.fatalErrors, 1);
    assert.equal(report.summary.peakLimits.QUEUEABLE_JOBS.usagePercentage, 200);
});

function fatalErrorLog(...fatalLines) {
    return [
        '64.0 APEX_CODE,FINEST',
        '09:00:00.0 (1000000)|EXECUTION_STARTED',
        '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.run()',
        `09:00:00.0 (3000000)|FATAL_ERROR|${fatalLines[0]}`,
        ...fatalLines.slice(1),
        '09:00:00.0 (4000000)|CODE_UNIT_FINISHED|Class.Test.run()',
        '09:00:00.0 (5000000)|EXECUTION_FINISHED',
    ].join('\n');
}

function parseErrors(log) {
    return new ApexLogParser().parse(log, 'fatal.log').summary.errors.map(error => {
        assert.equal(typeof error.eventId, 'string');
        const rest = { ...error };
        delete rest.eventId;
        return rest;
    });
}

test('summary error without a colon in the headline has an empty exception type', () => {
    const log = fatalErrorLog('Internal Salesforce Error', '', 'Class.A.b: line 4, column 1');

    assert.deepEqual(parseErrors(log), [{ exceptionType: '', message: 'Internal Salesforce Error', lineNumber: 4 }]);
});

test('summary error splits the stack trace after a single newline', () => {
    const log = fatalErrorLog('System.DmlException: Insert failed', 'Trigger.AccountTrigger: line 9, column 1');

    assert.deepEqual(parseErrors(log), [{ exceptionType: 'System.DmlException', message: 'Insert failed', lineNumber: 9 }]);
});

test('summary error message is not split on words that only resemble stack frames', () => {
    const log = fatalErrorLog('System.X: Error', '', 'Class not found');

    assert.deepEqual(parseErrors(log), [{ exceptionType: 'System.X', message: 'Error  Class not found' }]);
});

test('summary error splits the stack trace at a (System Code) frame', () => {
    const log = fatalErrorLog(
        'System.CalloutException: Read timed out',
        '',
        '(System Code)',
        'Class.Client.send: line 12, column 1',
    );

    assert.deepEqual(parseErrors(log), [{ exceptionType: 'System.CalloutException', message: 'Read timed out', lineNumber: 12 }]);
});

test('summary errors keep identical fatal errors from separate executions', () => {
    const block = fatalErrorLog('System.DmlException: Insert failed', '', 'Class.A.b: line 4, column 1').split('\n').slice(1);
    const log = ['64.0 APEX_CODE,FINEST', ...block, ...block].join('\n');

    assert.equal(parseErrors(log).length, 2);
});
