import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = resolve(repoRoot, 'dist/cli.js');

const userDebugLog = [
    '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
    '09:00:00.0 (1000000)|EXECUTION_STARTED',
    '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.run()',
    '09:00:00.0 (3000000)|METHOD_ENTRY|[10]|01p000000000001|Test.helper()',
    '09:00:00.0 (4000000)|USER_DEBUG|[371]|WARN|some message',
    '09:00:00.0 (5000000)|USER_DEBUG|[1052]|INFO|MyClass.method > a|b|c (cpu:1.507, heap:262.579)',
    '09:00:00.0 (6000000)|USER_DEBUG|[20]|DEBUG|first line',
    'second line',
    'third | line',
    '',
    '09:00:00.0 (7000000)|METHOD_EXIT|[10]|01p000000000001|Test.helper()',
    '09:00:00.0 (8000000)|CODE_UNIT_FINISHED|Class.Test.run()',
    '09:00:00.0 (9000000)|EXECUTION_FINISHED',
].join('\n');

function runCli(args, input = userDebugLog) {
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

function userDebugEvents(args = []) {
    return parseOutput(runCli(args)).events.filter(event => event.type === 'USER_DEBUG');
}

test('USER_DEBUG events expose lineNumber, debugLevel, message, and timeStart', () => {
    const [event] = userDebugEvents();

    assert.equal(event.type, 'USER_DEBUG');
    assert.equal(event.lineNumber, 371);
    assert.equal(event.debugLevel, 'WARN');
    assert.equal(event.message, 'some message');
    assert.equal(event.timeStart, 4000000);
});

test('USER_DEBUG message preserves pipe characters', () => {
    const event = userDebugEvents()[1];

    assert.equal(event.lineNumber, 1052);
    assert.equal(event.debugLevel, 'INFO');
    assert.equal(event.message, 'MyClass.method > a|b|c (cpu:1.507, heap:262.579)');
});

test('USER_DEBUG message preserves continuation lines and trims trailing newlines', () => {
    const event = userDebugEvents()[2];

    assert.equal(event.debugLevel, 'DEBUG');
    assert.equal(event.message, 'first line\nsecond line\nthird | line');
});

test('--type USER_DEBUG returns only USER_DEBUG events', () => {
    const parsedLog = parseOutput(runCli(['--type', 'USER_DEBUG']));

    assert.equal(parsedLog.events.length, 3);
    assert.ok(parsedLog.events.every(event => event.type === 'USER_DEBUG'));

    const excluded = parseOutput(runCli(['--exclude-type', 'USER_DEBUG']));
    assert.equal(excluded.events.some(event => event.type === 'USER_DEBUG'), false);
});

test('USER_DEBUG events inherit executionId and context from the enclosing node', () => {
    const parsedLog = parseOutput(runCli(['--type', 'USER_DEBUG', '--include-context']));
    const event = parsedLog.events[0];

    assert.equal(event.executionId, '00002');
    assert.deepEqual(
        event.context.stack.map(frame => [frame.type, frame.name]),
        [
            ['CODE_UNIT', 'Class.Test.run()'],
            ['METHOD', 'Test.helper()'],
        ],
    );
    assert.equal(event.parentId, event.context.stack[1].id);
});

test('--tree renders USER_DEBUG messages on a single line', () => {
    const result = runCli(['--tree']);

    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.split('\n').filter(line => line.includes('USER_DEBUG('));

    assert.equal(lines.length, 3);
    assert.match(lines[0], /USER_DEBUG\(\d+\) some message$/);
    assert.match(lines[1], /MyClass\.method > a\|b\|c \(cpu:1\.507, heap:262\.579\)$/);
    assert.match(lines[2], /USER_DEBUG\(\d+\) first line second line third \| line$/);
});
