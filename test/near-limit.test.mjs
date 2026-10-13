import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = resolve(repoRoot, 'dist/cli.js');

const nearLimitLog = [
    '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
    '09:00:00.0 (1000000)|EXECUTION_STARTED',
    '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.one()',
    '09:00:00.0 (3000000)|CUMULATIVE_LIMIT_USAGE',
    '09:00:00.0 (4000000)|LIMIT_USAGE_FOR_NS|(default)|',
    '  Number of SOQL queries: 68 out of 100',
    '  Number of queueable jobs added to the queue: 50 out of 50',
    '09:00:00.0 (5000000)|LIMIT_USAGE_FOR_NS|(default)|',
    '  Number of SOQL queries: 72 out of 100',
    '  Maximum CPU time: 7100 out of 10000',
    '  Number of queueable jobs added to the queue: 50 out of 50',
    '09:00:00.0 (6000000)|CUMULATIVE_LIMIT_USAGE_END',
    '09:00:00.0 (7000000)|CODE_UNIT_FINISHED|Class.Test.one()',
    '09:00:00.0 (9000000)|EXECUTION_FINISHED',
    '09:00:01.0 (10000000)|EXECUTION_STARTED',
    '09:00:01.0 (11000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.two()',
    '09:00:01.0 (12000000)|CUMULATIVE_LIMIT_USAGE',
    '09:00:01.0 (13000000)|LIMIT_USAGE_FOR_NS|(default)|',
    '  Number of SOQL queries: 20 out of 100',
    '09:00:01.0 (14000000)|TESTING_LIMITS',
    '09:00:01.0 (15000000)|LIMIT_USAGE_FOR_NS|(default)|',
    '  Number of SOQL queries: 80 out of 100',
    '  Number of DML statements: 70 out of 150',
    '09:00:01.0 (16000000)|CUMULATIVE_LIMIT_USAGE_END',
    '09:00:01.0 (17000000)|CODE_UNIT_FINISHED|Class.Test.two()',
    '09:00:01.0 (19000000)|EXECUTION_FINISHED',
].join('\n');

const belowThresholdLog = [
    '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
    '09:00:00.0 (1000000)|EXECUTION_STARTED',
    '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.quiet()',
    '09:00:00.0 (3000000)|CUMULATIVE_LIMIT_USAGE',
    '09:00:00.0 (4000000)|LIMIT_USAGE_FOR_NS|(default)|',
    '  Number of SOQL queries: 1 out of 100',
    '09:00:00.0 (5000000)|CUMULATIVE_LIMIT_USAGE_END',
    '09:00:00.0 (6000000)|CODE_UNIT_FINISHED|Class.Test.quiet()',
    '09:00:00.0 (7000000)|EXECUTION_FINISHED',
].join('\n');

const standaloneTestingLimitsLog = [
    '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
    '09:00:00.0 (1000000)|EXECUTION_STARTED',
    '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.standaloneMarker()',
    '09:00:00.0 (3000000)|CUMULATIVE_LIMIT_USAGE',
    '09:00:00.0 (4000000)|LIMIT_USAGE_FOR_NS|(default)|',
    '  Number of SOQL queries: 72 out of 100',
    '09:00:00.0 (5000000)|CUMULATIVE_LIMIT_USAGE_END',
    '09:00:00.0 (6000000)|TESTING_LIMITS',
    '09:00:00.0 (7000000)|CUMULATIVE_LIMIT_USAGE',
    '09:00:00.0 (8000000)|LIMIT_USAGE_FOR_NS|(default)|',
    '  Number of SOQL queries: 80 out of 100',
    '09:00:00.0 (9000000)|CUMULATIVE_LIMIT_USAGE_END',
    '09:00:00.0 (10000000)|CODE_UNIT_FINISHED|Class.Test.standaloneMarker()',
    '09:00:00.0 (11000000)|EXECUTION_FINISHED',
].join('\n');

const tempDir = mkdtempSync(join(tmpdir(), 'apex-log-parser-near-limit-'));
const belowThresholdPath = join(tempDir, 'below-threshold.log');
const nearLimitPath = join(tempDir, 'near-limit.log');
writeFileSync(belowThresholdPath, belowThresholdLog);
writeFileSync(nearLimitPath, nearLimitLog);
test.after(() => rmSync(tempDir, { recursive: true, force: true }));

const breachLog = [
    '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
    '09:00:00.0 (1000000)|EXECUTION_STARTED',
    '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.breach()',
    '09:00:00.0 (3000000)|FATAL_ERROR|System.LimitException: Too many queueable jobs added to the queue: 2',
    '09:00:00.0 (4000000)|CUMULATIVE_LIMIT_USAGE',
    '09:00:00.0 (5000000)|LIMIT_USAGE_FOR_NS|(default)|',
    '  Number of SOQL queries: 101 out of 100',
    '  Number of queueable jobs added to the queue: 2 out of 1',
    '09:00:00.0 (6000000)|CUMULATIVE_LIMIT_USAGE_END',
    '09:00:00.0 (7000000)|CODE_UNIT_FINISHED|Class.Test.breach()',
    '09:00:00.0 (8000000)|EXECUTION_FINISHED',
].join('\n');

function runCli(args, input = nearLimitLog) {
    return spawnSync(process.execPath, [cliPath, ...args], {
        input,
        encoding: 'utf8',
    });
}

function parseReport(result) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.notEqual(result.stdout.trim(), '');

    return JSON.parse(result.stdout);
}

test('--near-limit separates executions, scopes testing limits, and collapses repeated snapshots', () => {
    const report = parseReport(runCli(['--near-limit']));

    assert.deepEqual(
        report.nearLimitTransactions.map(transaction => transaction.label),
        ['Class.Test.one()', 'Class.Test.two()'],
    );

    const firstTransaction = report.nearLimitTransactions[0];
    assert.equal(firstTransaction.executionId, '00002');
    assert.deepEqual(
        firstTransaction.matches.map(match => [match.limit, match.scope, match.current, match.eventId]),
        [
            ['QUEUEABLE_JOBS', 'cumulative', 50, '00005'],
            ['SOQL_QUERIES', 'cumulative', 72, '00005'],
            ['CPU_TIME', 'cumulative', 7100, '00005'],
        ],
    );
    assert.deepEqual(
        firstTransaction.matches.map(match => [match.limit, match.threshold, match.breached]),
        [
            ['QUEUEABLE_JOBS', 100, false],
            ['SOQL_QUERIES', 70, false],
            ['CPU_TIME', 70, false],
        ],
    );

    const secondTransaction = report.nearLimitTransactions[1];
    assert.equal(secondTransaction.executionId, '00006');
    assert.deepEqual(
        secondTransaction.matches.map(match => [match.limit, match.scope, match.current]),
        [['SOQL_QUERIES', 'testing', 80]],
    );
});

test('--near-limit applies standalone TESTING_LIMITS to the next limit block', () => {
    const report = parseReport(runCli(['--near-limit'], standaloneTestingLimitsLog));
    const transaction = report.nearLimitTransactions[0];

    assert.deepEqual(
        transaction.matches.map(match => [match.limit, match.scope, match.current]),
        [
            ['SOQL_QUERIES', 'testing', 80],
            ['SOQL_QUERIES', 'cumulative', 72],
        ],
    );
});

test('LIMIT events expose namespace without duplicating it into name', () => {
    const result = runCli(['--type', 'LIMIT']);
    const parsedLog = parseReport(result);
    const limitEvent = parsedLog.events[0];

    assert.equal(limitEvent.type, 'LIMIT');
    assert.equal(limitEvent.namespace, 'default');
    assert.equal(limitEvent.name, undefined);
});

test('--limit-threshold opts into ignored limit types', () => {
    const report = parseReport(runCli(['--near-limit', '--limit-threshold', 'QUEUEABLE_JOBS=100']));
    const firstTransaction = report.nearLimitTransactions[0];
    const queueableMatch = firstTransaction.matches.find(match => match.limit === 'QUEUEABLE_JOBS');

    assert.ok(queueableMatch);
    assert.equal(queueableMatch.current, 50);
    assert.equal(queueableMatch.threshold, 100);
});

test('--exclude-limit wins over defaults and threshold overrides', () => {
    const report = parseReport(runCli([
        '--near-limit',
        '--limit-threshold',
        'QUEUEABLE_JOBS=100',
        '--exclude-limit',
        'QUEUEABLE_JOBS,SOQL_QUERIES',
    ]));

    assert.equal(report.nearLimitTransactions.length, 1);
    assert.deepEqual(
        report.nearLimitTransactions[0].matches.map(match => match.limit),
        ['CPU_TIME'],
    );
});

test('--near-limit always reports breaches, including limits without a default threshold', () => {
    const report = parseReport(runCli(['--near-limit'], breachLog));

    assert.equal(report.nearLimitTransactions.length, 1);
    assert.deepEqual(
        report.nearLimitTransactions[0].matches.map(match => [
            match.limit,
            match.current,
            match.max,
            match.usagePercentage,
            match.threshold,
            match.breached,
        ]),
        [
            ['QUEUEABLE_JOBS', 2, 1, 200, 100, true],
            ['SOQL_QUERIES', 101, 100, 101, 70, true],
        ],
    );
});

test('--near-limit does not report limits without a default threshold below their max', () => {
    const result = runCli(['--near-limit'], breachLog.replace(
        'Number of queueable jobs added to the queue: 2 out of 1',
        'Number of queueable jobs added to the queue: 199 out of 200',
    ).replace('Number of SOQL queries: 101 out of 100', 'Number of SOQL queries: 1 out of 100'));

    assert.deepEqual(parseReport(result).nearLimitTransactions, []);
});

test('--exclude-limit wins over the breach rule', () => {
    const result = runCli(['--near-limit', '--exclude-limit', 'QUEUEABLE_JOBS,SOQL_QUERIES'], breachLog);

    assert.deepEqual(parseReport(result).nearLimitTransactions, []);
});

test('--near-limit emits an empty report for logs with no matches', () => {
    const report = parseReport(runCli(['--near-limit'], belowThresholdLog));

    assert.equal(report.summary.source, 'stdin: 1');
    assert.deepEqual(report.nearLimitTransactions, []);
});

test('--near-limit emits one report per file in input order, including empty ones', () => {
    const result = runCli(['--near-limit', belowThresholdPath, nearLimitPath], '');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const reports = result.stdout
        .split(/\n(?=\{)/)
        .filter(chunk => chunk.trim().length > 0)
        .map(chunk => JSON.parse(chunk));

    assert.deepEqual(reports.map(report => report.summary.source), ['below-threshold.log', 'near-limit.log']);
    assert.deepEqual(reports[0].nearLimitTransactions, []);
    assert.ok(reports[1].nearLimitTransactions.length > 0);
});

test('--near-limit rejects invalid limit names and percentages', () => {
    const invalidLimit = runCli(['--near-limit', '--limit-threshold', 'BOGUS=50']);
    assert.equal(invalidLimit.status, 1);
    assert.match(invalidLimit.stderr, /Invalid limit type for --limit-threshold: BOGUS/);

    const invalidExcludedLimit = runCli(['--near-limit', '--exclude-limit', 'BOGUS']);
    assert.equal(invalidExcludedLimit.status, 1);
    assert.match(invalidExcludedLimit.stderr, /Invalid limit type for --exclude-limit: BOGUS/);

    const invalidPercentage = runCli(['--near-limit', '--limit-threshold', 'SOQL_QUERIES=101']);
    assert.equal(invalidPercentage.status, 1);
    assert.match(invalidPercentage.stderr, /Invalid percentage for --limit-threshold SOQL_QUERIES: 101/);
});

test('--near-limit rejects incompatible event and tree flags', () => {
    const filtered = runCli(['--near-limit', '--type', 'SOQL']);
    assert.equal(filtered.status, 1);
    assert.match(filtered.stderr, /Cannot combine --near-limit with --type/);

    const tree = runCli(['--near-limit', '--tree']);
    assert.equal(tree.status, 1);
    assert.match(tree.stderr, /Cannot combine --near-limit with --tree/);
});
