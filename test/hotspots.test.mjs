import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = resolve(repoRoot, 'dist/cli.js');

// A.run() recurses once; the DML and SOQL below it hold most of the time.
const recursiveLog = [
    '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
    '09:00:00.0 (1000000)|EXECUTION_STARTED',
    '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000000001|AccountTrigger on Account trigger event AfterInsert',
    '09:00:00.0 (3000000)|METHOD_ENTRY|[10]|01p000000000001|A.run()',
    '09:00:00.0 (4000000)|METHOD_ENTRY|[11]|01p000000000001|A.run()',
    '09:00:00.0 (5000000)|DML_BEGIN|[12]|Op:Insert|Type:Account|Rows:1',
    '09:00:00.0 (6000000)|SOQL_EXECUTE_BEGIN|[13]|Aggregations:0|SELECT Id FROM Contact',
    '09:00:00.0 (60000000)|SOQL_EXECUTE_END|[13]|Rows:3',
    '09:00:00.0 (70000000)|DML_END|[12]',
    '09:00:00.0 (80000000)|METHOD_EXIT|[11]|01p000000000001|A.run()',
    '09:00:00.0 (90000000)|METHOD_EXIT|[10]|01p000000000001|A.run()',
    '09:00:00.0 (91000000)|METHOD_ENTRY|[20]|01p000000000001|B.cheap()',
    '09:00:00.0 (92000000)|USER_DEBUG|[21]|DEBUG|hello',
    '09:00:00.0 (93000000)|METHOD_EXIT|[20]|01p000000000001|B.cheap()',
    '09:00:00.0 (99000000)|CODE_UNIT_FINISHED|AccountTrigger on Account trigger event AfterInsert',
    '09:00:00.0 (100000000)|EXECUTION_FINISHED',
].join('\n');

function runCli(args, input = recursiveLog) {
    return spawnSync(process.execPath, [cliPath, ...args], {
        input,
        encoding: 'utf8',
    });
}

function parseOutput(result) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
}

function summarize(hotspots) {
    return hotspots.map(hotspot => [hotspot.type, hotspot.name, hotspot.count, hotspot.totalSelfMs, hotspot.maxSelfMs, hotspot.inclusiveMs]);
}

test('events expose selfMs as duration minus direct children durations', () => {
    const { events } = parseOutput(runCli([]));
    const selfById = Object.fromEntries(events.map(event => [event.id, [event.type, event.durationMs, event.selfMs]]));

    assert.deepEqual(selfById, {
        '00002': ['EXECUTION', 99, 2],
        '00003': ['CODE_UNIT', 97, 8],
        '00004': ['METHOD', 87, 11],
        '00005': ['METHOD', 76, 11],
        '00006': ['DML', 65, 11],
        '00007': ['SOQL', 54, 54],
        '00008': ['METHOD', 2, 2],
        '00009': ['USER_DEBUG', 0, 0],
    });
});

test('--hotspots ranks groups by total self time without double-counting recursion', () => {
    const report = parseOutput(runCli(['--hotspots']));

    assert.deepEqual(Object.keys(report), ['summary', 'hotspots']);
    assert.equal(report.summary.durationMs, 99);
    assert.deepEqual(summarize(report.hotspots), [
        ['SOQL', 'Query on contact', 1, 54, 54, 54],
        ['METHOD', 'A.run()', 2, 22, 11, 87],
        ['DML', 'Insert on Account', 1, 11, 11, 65],
        ['CODE_UNIT', 'AccountTrigger on Account trigger event AfterInsert', 1, 8, 8, 97],
        ['METHOD', 'B.cheap()', 1, 2, 2, 2],
    ]);

    const recursive = report.hotspots[1];
    assert.deepEqual(
        { ...recursive.slowest, context: undefined },
        { id: '00004', durationMs: 87, selfMs: 11, lineNumber: 10, context: undefined },
    );

    const soql = report.hotspots[0];
    assert.deepEqual(
        soql.slowest.context.stack.map(frame => [frame.id, frame.type]),
        [['00003', 'CODE_UNIT'], ['00004', 'METHOD'], ['00005', 'METHOD'], ['00006', 'DML']],
    );
});

test('--top limits hotspots and --type / --exclude-type restrict grouped events', () => {
    const top = parseOutput(runCli(['--hotspots', '--top', '2']));
    assert.deepEqual(top.hotspots.map(hotspot => hotspot.name), ['Query on contact', 'A.run()']);

    const methods = parseOutput(runCli(['--hotspots', '--type', 'METHOD']));
    assert.deepEqual(methods.hotspots.map(hotspot => hotspot.name), ['A.run()', 'B.cheap()']);

    const excluded = parseOutput(runCli(['--hotspots', '--exclude-type', 'SOQL,CODE_UNIT']));
    assert.deepEqual(excluded.hotspots.map(hotspot => hotspot.type), ['METHOD', 'DML', 'METHOD']);
});

test('--hotspots groups DML regardless of row count and CALLOUT by request', () => {
    const log = [
        '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
        '09:00:00.0 (1000000)|EXECUTION_STARTED',
        '09:00:00.0 (2000000)|DML_BEGIN|[12]|Op:Insert|Type:Account|Rows:1',
        '09:00:00.0 (3000000)|DML_END|[12]',
        '09:00:00.0 (4000000)|DML_BEGIN|[12]|Op:Insert|Type:Account|Rows:200',
        '09:00:00.0 (9000000)|DML_END|[12]',
        '09:00:00.0 (10000000)|CALLOUT_REQUEST|[5]|System.HttpRequest[Endpoint=https://a.example, Method=GET]',
        '09:00:00.0 (12000000)|CALLOUT_RESPONSE|[5]|System.HttpResponse[Status=OK, StatusCode=200]',
        '09:00:00.0 (20000000)|EXECUTION_FINISHED',
    ].join('\n');
    const report = parseOutput(runCli(['--hotspots'], log));

    assert.deepEqual(summarize(report.hotspots), [
        ['DML', 'Insert on Account', 2, 6, 5, 6],
        ['CALLOUT', 'System.HttpRequest[Endpoint=https://a.example, Method=GET]', 1, 2, 2, 2],
    ]);
});

test('--hotspots omits logs with no qualifying events', () => {
    const result = runCli(['--hotspots', '--type', 'USER_DEBUG']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '');
});

test('--hotspots rejects incompatible flags and invalid --top', () => {
    for (const [args, message] of [
        [['--hotspots', '--tree'], /Cannot combine --hotspots with --tree/],
        [['--hotspots', '--include-tree'], /Cannot combine --hotspots with --include-tree/],
        [['--hotspots', '--near-limit'], /Cannot combine --hotspots with --near-limit/],
        [['--hotspots', '--min-duration-ms', '5'], /Cannot combine --hotspots with --min-duration-ms/],
        [['--top', '5'], /Cannot use --top without --hotspots/],
        [['--hotspots', '--top', '0'], /Invalid value for --top/],
        [['--hotspots', '--top', '1.5'], /Invalid value for --top/],
        [['--hotspots', '--top', '1e3'], /Invalid value for --top/],
        [['--hotspots', '--top', '0x10'], /Invalid value for --top/],
    ]) {
        const result = runCli(args);
        assert.equal(result.status, 1, args.join(' '));
        assert.match(result.stderr, message);
    }
});
