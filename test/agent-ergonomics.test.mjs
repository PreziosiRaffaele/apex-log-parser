import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

// Minimal validator for the JSON Schema keywords used by --json-schema.
function validate(schema, value, root, path = '$') {
    const errors = [];
    if (schema.$ref) {
        const name = schema.$ref.replace('#/$defs/', '');
        assert.ok(root.$defs[name], `unresolved $ref ${schema.$ref}`);
        return validate(root.$defs[name], value, root, path);
    }
    if (schema.oneOf) {
        const matches = schema.oneOf.filter(option => validate(option, value, root, path).length === 0);
        if (matches.length !== 1) errors.push(`${path}: expected exactly one oneOf match, got ${matches.length}`);
        return errors;
    }
    if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
    if (schema.type === 'object') {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path}: expected object`];
        for (const key of schema.required ?? []) {
            if (!(key in value)) errors.push(`${path}: missing required ${key}`);
        }
        for (const [key, child] of Object.entries(value)) {
            if (schema.propertyNames) errors.push(...validate(schema.propertyNames, key, root, `${path}[key ${key}]`));
            const childSchema = schema.properties?.[key] ?? schema.additionalProperties;
            if (childSchema && typeof childSchema === 'object') errors.push(...validate(childSchema, child, root, `${path}.${key}`));
        }
    } else if (schema.type === 'array') {
        if (!Array.isArray(value)) return [`${path}: expected array`];
        value.forEach((item, index) => errors.push(...validate(schema.items, item, root, `${path}[${index}]`)));
    } else if (schema.type === 'integer') {
        if (!Number.isInteger(value)) errors.push(`${path}: expected integer`);
    } else if (schema.type && typeof value !== schema.type) {
        errors.push(`${path}: expected ${schema.type}`);
    }
    return errors;
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

test('FATAL_ERROR without a blank-line separator keeps the whole text as the message', () => {
    const [event] = parseFatalErrors(
        '09:00:00.0 (3000000)|FATAL_ERROR|System.DmlException: Insert failed',
        'Class.Caller.go: line 1, column 1',
    );

    assert.equal(event.message, 'System.DmlException: Insert failed\nClass.Caller.go: line 1, column 1');
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

test('--tree shows the FATAL_ERROR message without the stack trace', () => {
    const result = runCli([fixturePath, '--tree']);

    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.split('\n').filter(line => line.includes('FATAL_ERROR('));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /FATAL_ERROR\(\d+\) System\.LimitException: Too many queueable jobs added to the queue: 2$/);
});

test('--json-schema prints a draft 2020-12 schema whose $refs resolve', () => {
    const schema = parseOutput(runCli(['--json-schema']));

    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    const refs = JSON.stringify(schema).match(/#\/\$defs\/\w+/g);
    for (const ref of refs) {
        assert.ok(schema.$defs[ref.replace('#/$defs/', '')], `unresolved ${ref}`);
    }
});

test('fixture CLI output validates against --json-schema', () => {
    const schema = parseOutput(runCli(['--json-schema']));
    const outputs = {
        default: parseOutput(runCli([fixturePath])),
        withTreeAndContext: parseOutput(runCli([fixturePath, '--include-tree', '--include-context'])),
        nearLimit: parseOutput(runCli([fixturePath, '--near-limit'])),
    };

    assert.ok(outputs.nearLimit.nearLimitTransactions.length > 0);
    for (const [name, output] of Object.entries(outputs)) {
        assert.deepEqual(validate(schema, output, schema), [], `${name} output does not match schema`);
    }
    assert.notDeepEqual(validate(schema, { summary: outputs.default.summary }, schema), []);
});

test('--skill prints the packaged SKILL.md', () => {
    const result = runCli(['--skill']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, readFileSync(resolve(repoRoot, 'skills/apex-log-parser/SKILL.md'), 'utf8'));
    assert.match(result.stdout, /^---\nname: apex-log-parser\ndescription: .+\n---\n/);

    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
    assert.ok(packageJson.files.includes('skills/**/*'));
});
