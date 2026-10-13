import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = resolve(repoRoot, 'dist/cli.js');
const fixturePath = resolve(repoRoot, 'test/fixtures/fatal-error.log');

function runCli(args, input) {
    return spawnSync(process.execPath, [cliPath, ...args], {
        input,
        encoding: 'utf8',
        env: { ...process.env, COLUMNS: '160' },
    });
}

function parseOutput(result) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');

    return JSON.parse(result.stdout);
}

test('FATAL_ERROR is deduplicated and split into message and stackTrace', () => {
    const events = parseOutput(runCli([fixturePath, '--type', 'FATAL_ERROR'])).events;

    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event.name, 'System.LimitException: Too many queueable jobs added to the queue: 2');
    assert.equal(event.message, event.name);
    assert.equal(event.exceptionType, 'System.LimitException');
    assert.deepEqual(event.stackTrace, [
        { frame: 'Class.OrderHandler.afterInsert', lineNumber: 42, column: 1 },
        { frame: 'Class.TriggerBase.run', lineNumber: 12, column: 5 },
        { frame: 'Trigger.OrderTrigger', lineNumber: 9, column: 1 },
    ]);
});

test('FATAL_ERROR keeps non-consecutive repeats and handles messages without a stack trace', () => {
    const log = [
        '64.0 APEX_CODE,FINEST',
        '09:00:00.0 (1000000)|EXECUTION_STARTED',
        '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex',
        '09:00:00.0 (3000000)|FATAL_ERROR|System.LimitException: Apex CPU time limit exceeded',
        '09:00:00.0 (4000000)|USER_DEBUG|[1]|DEBUG|between',
        '09:00:00.0 (5000000)|FATAL_ERROR|System.LimitException: Apex CPU time limit exceeded',
        '09:00:00.0 (6000000)|CODE_UNIT_FINISHED|execute_anonymous_apex',
        '09:00:00.0 (7000000)|EXECUTION_FINISHED',
    ].join('\n');
    const events = parseOutput(runCli(['--type', 'FATAL_ERROR'], log)).events;

    assert.equal(events.length, 2);
    assert.equal(events[0].message, 'System.LimitException: Apex CPU time limit exceeded');
    assert.deepEqual(events[0].stackTrace, []);
});

function parseFatalErrors(...fatalErrorLines) {
    const log = [
        '64.0 APEX_CODE,FINEST',
        '09:00:00.0 (1000000)|EXECUTION_STARTED',
        '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex',
        ...fatalErrorLines,
        '09:00:00.0 (9000000)|CODE_UNIT_FINISHED|execute_anonymous_apex',
        '09:00:00.0 (9500000)|EXECUTION_FINISHED',
    ].join('\n');
    return parseOutput(runCli(['--type', 'FATAL_ERROR'], log)).events;
}

test('FATAL_ERROR drops hidden-frame markers and accepts any located or bare frame', () => {
    const [event] = parseFatalErrors(
        '09:00:00.0 (3000000)|FATAL_ERROR|System.NullPointerException: Attempt to de-reference a null object',
        '',
        'Class.ns.Service.run: line 5, column 1',
        '(System Code)',
        '(ns)',
        'ns.Helper: line 7, column 3',
        'Class.Caller.go',
        'AnonymousBlock',
        'External entry point',
    );

    assert.equal(event.message, 'System.NullPointerException: Attempt to de-reference a null object');
    assert.deepEqual(event.stackTrace, [
        { frame: 'Class.ns.Service.run', lineNumber: 5, column: 1 },
        { frame: 'ns.Helper', lineNumber: 7, column: 3 },
        { frame: 'Class.Caller.go' },
        { frame: 'AnonymousBlock' },
    ]);
});

test('FATAL_ERROR accepts located frames without a blank-line separator', () => {
    const [event] = parseFatalErrors(
        '09:00:00.0 (3000000)|FATAL_ERROR|System.DmlException: Insert failed',
        'Class.Caller.go: line 1, column 1',
    );

    assert.equal(event.message, 'System.DmlException: Insert failed');
    assert.deepEqual(event.stackTrace, [{ frame: 'Class.Caller.go', lineNumber: 1, column: 1 }]);
});

test('FATAL_ERROR keeps bare frame-like lines in the message without a blank-line separator', () => {
    const [event] = parseFatalErrors(
        '09:00:00.0 (3000000)|FATAL_ERROR|MyException: failed in',
        'Trigger.Handler',
    );

    assert.equal(event.message, 'MyException: failed in\nTrigger.Handler');
    assert.deepEqual(event.stackTrace, []);
});

test('FATAL_ERROR keeps message newlines while name stays on one line', () => {
    const [event] = parseFatalErrors(
        '09:00:00.0 (3000000)|FATAL_ERROR|System.DmlException: Insert failed. First exception on row 0;',
        'REQUIRED_FIELD_MISSING: Name',
        '',
        'Class.Caller.go: line 4, column 1',
        '',
    );

    assert.equal(event.message, 'System.DmlException: Insert failed. First exception on row 0;\nREQUIRED_FIELD_MISSING: Name');
    assert.equal(event.name, 'System.DmlException: Insert failed. First exception on row 0; REQUIRED_FIELD_MISSING: Name');
    assert.deepEqual(event.stackTrace, [{ frame: 'Class.Caller.go', lineNumber: 4, column: 1 }]);
});

test('FATAL_ERROR decodes escaped pipes and omits exceptionType without a colon', () => {
    const [event] = parseFatalErrors('09:00:00.0 (3000000)|FATAL_ERROR|Script failed for a &#124; b');

    assert.equal(event.message, 'Script failed for a | b');
    assert.equal('exceptionType' in event, false);
});

test('FATAL_ERROR takes exceptionType only from the first message line', () => {
    const log = [
        '64.0 APEX_CODE,FINEST',
        '09:00:00.0 (1000000)|EXECUTION_STARTED',
        '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex',
        '09:00:00.0 (3000000)|FATAL_ERROR|Script failed',
        'REQUIRED_FIELD_MISSING: Name',
        '09:00:00.0 (4000000)|USER_DEBUG|[1]|DEBUG|between',
        '09:00:00.0 (5000000)|FATAL_ERROR|System.DmlException: Insert failed',
        'REQUIRED_FIELD_MISSING: Name',
        '09:00:00.0 (9000000)|CODE_UNIT_FINISHED|execute_anonymous_apex',
        '09:00:00.0 (9500000)|EXECUTION_FINISHED',
    ].join('\n');
    const output = parseOutput(runCli(['--type', 'FATAL_ERROR'], log));

    assert.equal('exceptionType' in output.events[0], false);
    assert.equal(output.events[1].exceptionType, 'System.DmlException');
    assert.deepEqual(output.summary.errors.map(({ exceptionType, message }) => ({ exceptionType, message })), [
        { exceptionType: '', message: 'Script failed REQUIRED_FIELD_MISSING: Name' },
        { exceptionType: 'System.DmlException', message: 'Insert failed REQUIRED_FIELD_MISSING: Name' },
    ]);
});

test('FATAL_ERROR summary lineNumber comes from the first located frame', () => {
    const log = [
        '64.0 APEX_CODE,FINEST',
        '09:00:00.0 (1000000)|EXECUTION_STARTED',
        '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex',
        '09:00:00.0 (3000000)|FATAL_ERROR|System.NullPointerException: boom',
        '',
        'Class.Inner.run',
        'Class.Outer.go: line 27, column 1',
        '09:00:00.0 (9000000)|CODE_UNIT_FINISHED|execute_anonymous_apex',
        '09:00:00.0 (9500000)|EXECUTION_FINISHED',
    ].join('\n');
    const [error] = parseOutput(runCli(['--type', 'FATAL_ERROR'], log)).summary.errors;

    assert.equal(error.lineNumber, 27);
});

test('FATAL_ERROR accepts bare frames without a blank-line separator when a located frame is present', () => {
    const [event] = parseFatalErrors(
        '09:00:00.0 (3000000)|FATAL_ERROR|System.DmlException: Insert failed',
        'Class.Inner.run',
        '(System Code)',
        'Class.Outer.go: line 3, column 1',
        'AnonymousBlock',
    );

    assert.equal(event.message, 'System.DmlException: Insert failed');
    assert.deepEqual(event.stackTrace, [
        { frame: 'Class.Inner.run' },
        { frame: 'Class.Outer.go', lineNumber: 3, column: 1 },
        { frame: 'AnonymousBlock' },
    ]);
});

test('FATAL_ERROR with only frames keeps them and has an empty message', () => {
    const [event] = parseFatalErrors(
        '09:00:00.0 (3000000)|FATAL_ERROR|Class.Inner.run: line 2, column 1',
        'Class.Outer.go',
        'External entry point',
    );

    assert.equal(event.message, '');
    assert.deepEqual(event.stackTrace, [
        { frame: 'Class.Inner.run', lineNumber: 2, column: 1 },
        { frame: 'Class.Outer.go' },
    ]);
});

test('--tree shows the FATAL_ERROR message without the stack trace', () => {
    const result = runCli([fixturePath, '--tree']);

    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.split('\n').filter(line => line.includes('FATAL_ERROR('));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /FATAL_ERROR\(\d+\) System\.LimitException: Too many queueable jobs added to the queue: 2$/);
});
