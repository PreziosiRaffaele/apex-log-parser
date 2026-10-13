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

const soqlLog = [
    '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
    '09:00:00.0 (1000000)|EXECUTION_STARTED',
    '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.run()',
    '09:00:00.0 (3000000)|SOQL_EXECUTE_BEGIN|[5]|Aggregations:0|SELECT Id FROM Account LIMIT 1',
    '09:00:00.0 (4000000)|SOQL_EXECUTE_END|[5]|Rows:1',
    '09:00:00.0 (5000000)|CODE_UNIT_FINISHED|Class.Test.run()',
    '09:00:00.0 (6000000)|EXECUTION_FINISHED',
].join('\n');

const noSoqlLog = [
    '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
    '09:00:00.0 (1000000)|EXECUTION_STARTED',
    '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.quiet()',
    '09:00:00.0 (3000000)|CODE_UNIT_FINISHED|Class.Test.quiet()',
    '09:00:00.0 (4000000)|EXECUTION_FINISHED',
].join('\n');

const tempDir = mkdtempSync(join(tmpdir(), 'apex-log-parser-empty-'));
const soqlPath = join(tempDir, 'soql.log');
const noSoqlPath = join(tempDir, 'no-soql.log');
writeFileSync(soqlPath, soqlLog);
writeFileSync(noSoqlPath, noSoqlLog);
test.after(() => rmSync(tempDir, { recursive: true, force: true }));

function runCli(args, input = '') {
    return spawnSync(process.execPath, [cliPath, ...args], {
        input,
        encoding: 'utf8',
    });
}

function parseOutputs(result) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return result.stdout
        .split(/\n(?=\{)/)
        .filter(chunk => chunk.trim().length > 0)
        .map(chunk => JSON.parse(chunk));
}

test('--type emits summary with empty events when a single log has no matches', () => {
    const [output, ...rest] = parseOutputs(runCli(['--type', 'DML'], noSoqlLog));

    assert.deepEqual(rest, []);
    assert.equal(output.summary.source, 'stdin: 1');
    assert.deepEqual(output.events, []);
});

test('--exclude-type and --min-duration-ms emit empty events instead of omitting the log', () => {
    const [excluded] = parseOutputs(runCli(['--type', 'SOQL', '--exclude-type', 'SOQL'], soqlLog));
    assert.deepEqual(excluded.events, []);

    const [slow] = parseOutputs(runCli(['--min-duration-ms', '100000'], soqlLog));
    assert.deepEqual(slow.events, []);
});

test('filters keep one result per parsed file, in input order', () => {
    const outputs = parseOutputs(runCli(['--type', 'SOQL', noSoqlPath, soqlPath]));

    assert.deepEqual(outputs.map(output => output.summary.source), ['no-soql.log', 'soql.log']);
    assert.deepEqual(outputs[0].events, []);
    assert.deepEqual(outputs[1].events.map(event => event.type), ['SOQL']);
});

test('--include-tree is still emitted for logs with no matching events', () => {
    const [output] = parseOutputs(runCli(['--type', 'DML', '--include-tree'], noSoqlLog));

    assert.deepEqual(output.events, []);
    assert.ok(output.tree);
});

test('raw stdin with multiple logs keeps one result per log under filters', () => {
    const outputs = parseOutputs(runCli(['--type', 'SOQL'], `${noSoqlLog}\n${soqlLog}\n`));

    assert.deepEqual(outputs.map(output => output.summary.source), ['stdin: 1', 'stdin: 2']);
    assert.deepEqual(outputs[0].events, []);
    assert.deepEqual(outputs[1].events.map(event => event.type), ['SOQL']);
});

test('NDJSON stdin keeps one result per line under filters', () => {
    const input = [
        JSON.stringify({ Id: '07L000000000001', Log: noSoqlLog }),
        JSON.stringify({ Id: '07L000000000002', Log: soqlLog }),
    ].join('\n') + '\n';
    const outputs = parseOutputs(runCli(['--input-format', 'ndjson', '--type', 'SOQL'], input));

    assert.deepEqual(outputs.map(output => output.summary.source), ['07L000000000001', '07L000000000002']);
    assert.deepEqual(outputs[0].events, []);
    assert.deepEqual(outputs[1].events.map(event => event.type), ['SOQL']);
});
