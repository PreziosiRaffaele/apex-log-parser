import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = resolve(repoRoot, 'dist/cli.js');

const nestedLog = [
    '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
    '09:00:00.0 (1000000)|EXECUTION_STARTED',
    '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.run()',
    '09:00:00.0 (3000000)|METHOD_ENTRY|[1]|01p000000000001|Test.fastA()',
    '09:00:00.0 (4000000)|METHOD_EXIT|[1]|01p000000000001|Test.fastA()',
    '09:00:00.0 (5000000)|METHOD_ENTRY|[2]|01p000000000001|Test.fastB()',
    '09:00:00.0 (7000000)|METHOD_EXIT|[2]|01p000000000001|Test.fastB()',
    '09:00:00.0 (8000000)|METHOD_ENTRY|[3]|01p000000000001|Test.slow()',
    '09:00:00.0 (9000000)|METHOD_ENTRY|[4]|01p000000000001|Test.inner()',
    '09:00:00.0 (10000000)|SOQL_EXECUTE_BEGIN|[5]|Aggregations:0|SELECT Id FROM Account',
    '09:00:00.0 (110000000)|SOQL_EXECUTE_END|[5]|Rows:1',
    '09:00:00.0 (111000000)|METHOD_EXIT|[4]|01p000000000001|Test.inner()',
    '09:00:00.0 (112000000)|METHOD_EXIT|[3]|01p000000000001|Test.slow()',
    '09:00:00.0 (113000000)|CODE_UNIT_FINISHED|Class.Test.run()',
    '09:00:00.0 (114000000)|EXECUTION_FINISHED',
].join('\n');

function runCli(args, input = nestedLog) {
    return spawnSync(process.execPath, [cliPath, ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        input,
    });
}

function treeLines(stdout) {
    return stdout.trimEnd().split('\n');
}

test('--tree --max-depth replaces deeper subtrees with a descendant count', () => {
    const result = runCli(['--tree', '--max-depth', '2']);

    assert.equal(result.status, 0, result.stderr);
    const lines = treeLines(result.stdout);
    assert.equal(lines.length, 4);
    assert.match(lines[2], /CODE_UNIT\(00003\)/);
    assert.equal(lines[3], '        └── … 5 descendants hidden');
});

test('--tree --max-depth 0 renders only ROOT and the hidden count', () => {
    const result = runCli(['--tree', '--max-depth', '0']);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(treeLines(result.stdout), ['ROOT(00001)', '└── … 7 descendants hidden']);
});

test('--tree --min-duration-ms keeps slow paths and collapses fast siblings', () => {
    const result = runCli(['--tree', '--min-duration-ms', '50']);

    assert.equal(result.status, 0, result.stderr);
    const lines = treeLines(result.stdout);
    assert.ok(lines.some((line) => line.includes('SOQL(00008)')));
    assert.ok(lines.some((line) => line.includes('METHOD(00006) Test.slow()')));
    assert.ok(!result.stdout.includes('Test.fastA()'));
    assert.ok(!result.stdout.includes('Test.fastB()'));
    assert.equal(lines.at(-1), '        └── … 2 nodes hidden [3ms total]');
});

test('--tree combines --max-depth and --min-duration-ms', () => {
    const result = runCli(['--tree', '--max-depth', '3', '--min-duration-ms', '50']);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(treeLines(result.stdout).slice(3), [
        '        ├── METHOD(00006) Test.slow() [104ms|92%] ██████████████████',
        '        │   └── … 2 descendants hidden',
        '        └── … 2 nodes hidden [3ms total]',
    ]);
});

test('--include-tree --max-depth prunes the JSON tree but not events', () => {
    const result = runCli(['--include-tree', '--max-depth', '2']);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    const codeUnit = output.tree.children[0].children[0];
    assert.equal(codeUnit.id, '00003');
    assert.equal(codeUnit.children, undefined);
    assert.equal(codeUnit.hiddenDescendants, 5);
    assert.equal(output.events.length, 7);
});

test('--include-tree keeps --min-duration-ms as an events-only filter', () => {
    const result = runCli(['--include-tree', '--min-duration-ms', '50']);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.tree.children[0].children[0].children.length, 3);
    assert.ok(output.events.every((event) => event.durationMs >= 50));
});

test('--compact prints each JSON result on a single line', () => {
    const pretty = runCli([]);
    const compact = runCli(['--compact']);

    assert.equal(compact.status, 0, compact.stderr);
    assert.equal(compact.stdout, JSON.stringify(JSON.parse(pretty.stdout)) + '\n');
});

test('--compact emits NDJSON for multiple logs', () => {
    const result = runCli(['--compact', '--include-tree', '--max-depth', '1'], `${nestedLog}\n${nestedLog}`);

    assert.equal(result.status, 0, result.stderr);
    const lines = treeLines(result.stdout);
    assert.equal(lines.length, 2);
    for (const line of lines) {
        assert.equal(JSON.parse(line).tree.children[0].hiddenDescendants, 6);
    }
});

test('--compact applies to --near-limit output', () => {
    const nearLimitLog = [
        '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
        '09:00:00.0 (1000000)|EXECUTION_STARTED',
        '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.one()',
        '09:00:00.0 (3000000)|CUMULATIVE_LIMIT_USAGE',
        '09:00:00.0 (4000000)|LIMIT_USAGE_FOR_NS|(default)|',
        '  Number of SOQL queries: 90 out of 100',
        '09:00:00.0 (5000000)|CUMULATIVE_LIMIT_USAGE_END',
        '09:00:00.0 (6000000)|CODE_UNIT_FINISHED|Class.Test.one()',
        '09:00:00.0 (7000000)|EXECUTION_FINISHED',
    ].join('\n');
    const result = runCli(['--near-limit', '--compact'], nearLimitLog);

    assert.equal(result.status, 0, result.stderr);
    const lines = treeLines(result.stdout);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).nearLimitTransactions.length, 1);
});

test('rejects invalid tree pruning and compact combinations', () => {
    const cases = [
        [['--max-depth', '2'], /Cannot use --max-depth without --tree or --include-tree/],
        [['--tree', '--max-depth=-1'], /Invalid value for --max-depth/],
        [['--tree', '--max-depth', '1.5'], /Invalid value for --max-depth/],
        [['--tree', '--max-depth', ''], /Invalid value for --max-depth/],
        [['--tree', '--max-depth=0x10'], /Invalid value for --max-depth/],
        [['--tree', '--max-depth=1e3'], /Invalid value for --max-depth/],
        [['--tree', '--compact'], /Cannot combine --compact with --tree/],
        [['--tree', '--type', 'SOQL'], /Cannot combine --type or --exclude-type with --tree/],
        [['--tree', '--exclude-type', 'SOQL'], /Cannot combine --type or --exclude-type with --tree/],
    ];

    for (const [args, expected] of cases) {
        const result = runCli(args);
        assert.equal(result.status, 1, args.join(' '));
        assert.match(result.stderr, expected);
    }
});
