import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = resolve(repoRoot, 'dist/cli.js');

const sampleLog = [
    '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST',
    '09:00:00.0 (1000000)|EXECUTION_STARTED',
    '09:00:00.0 (2000000)|CODE_UNIT_STARTED|[EXTERNAL]|Class.Test.run()',
    '09:00:00.0 (3000000)|SOQL_EXECUTE_BEGIN|[5]|Aggregations:0|SELECT Id FROM Account LIMIT 1',
    '09:00:00.0 (4000000)|SOQL_EXECUTE_END|[5]|Rows:1',
    '09:00:00.0 (5000000)|CODE_UNIT_FINISHED|Class.Test.run()',
    '09:00:00.0 (6000000)|EXECUTION_FINISHED',
].join('\n');

const tempDir = mkdtempSync(join(tmpdir(), 'apex-log-parser-'));
const logPaths = ['a.log', 'b.log', 'c.log'].map((name) => {
    const logPath = join(tempDir, name);
    writeFileSync(logPath, sampleLog);
    return logPath;
});
test.after(() => rmSync(tempDir, { recursive: true, force: true }));

const parserUrl = pathToFileURL(resolve(repoRoot, 'dist/ApexLogParser.js')).href;
// Preloads used to reach states that are hard to produce from a test process.
const failingParsePreload = `
import { ApexLogParser } from ${JSON.stringify(parserUrl)};
const parse = ApexLogParser.prototype.parse;
ApexLogParser.prototype.parse = function (log, ...rest) {
    if (log.includes('FAIL_PARSE')) throw new Error('boom');
    return parse.call(this, log, ...rest);
};
`;
const ttyStdinPreload = `Object.defineProperty(process.stdin, 'isTTY', { value: true });`;

function preload(source) {
    return ['--import', `data:text/javascript,${encodeURIComponent(source)}`];
}

const failingLog = sampleLog.replace('Class.Test.run()', 'Class.Test.FAIL_PARSE()');

function runCli(args, input = '', nodeArgs = []) {
    return spawnSync(process.execPath, [...nodeArgs, cliPath, ...args], {
        input,
        encoding: 'utf8',
    });
}

function parseSources(result) {
    assert.equal(result.status, 0, result.stderr);
    return result.stdout
        .split(/\n(?=\{)/)
        .filter(chunk => chunk.trim().length > 0)
        .map(chunk => JSON.parse(chunk).summary.source);
}

test('positional arguments are parsed as input files', () => {
    assert.deepEqual(parseSources(runCli([logPaths[0]])), ['a.log']);
    assert.deepEqual(parseSources(runCli(['--type', 'SOQL', logPaths[0], logPaths[1]])), ['a.log', 'b.log']);
});

test('-f accepts multiple files', () => {
    assert.deepEqual(parseSources(runCli(['-f', ...logPaths])), ['a.log', 'b.log', 'c.log']);
});

test('-f values and positionals keep command-line order', () => {
    assert.deepEqual(
        parseSources(runCli([logPaths[2], '-f', logPaths[0], '--type', 'SOQL', logPaths[1]])),
        ['c.log', 'a.log', 'b.log'],
    );
});

test('missing positional file exits with an error', () => {
    const result = runCli([join(tempDir, 'missing.log')]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /File not found/);
    assert.equal(result.stdout, '');
});

test('interactive stdin without files prints help to stderr and exits 1', () => {
    const result = runCli([], '', preload(ttyStdinPreload));

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage:/);
});

test('raw stdin without an Apex log header exits 1', () => {
    const result = runCli([], 'garbage\n');

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /No Apex log found in stdin/);
});

test('raw stdin parses every log and exits 0', () => {
    const result = runCli([], `${sampleLog}\n${sampleLog}\n`);

    assert.deepEqual(parseSources(result), ['stdin: 1', 'stdin: 2']);
    assert.equal(result.stderr, '');
});

test('raw stdin reports parse failures and exits 2 on partial success', () => {
    const result = runCli([], `${sampleLog}\n${failingLog}\n`, preload(failingParsePreload));

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Error parsing stdin: 2: boom/);
    assert.equal(JSON.parse(result.stdout).summary.source, 'stdin: 1');
});

test('raw stdin exits 1 when every log fails to parse', () => {
    const result = runCli([], `${failingLog}\n${failingLog}\n`, preload(failingParsePreload));

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Error parsing stdin: 1: boom/);
    assert.match(result.stderr, /Error parsing stdin: 2: boom/);
});
