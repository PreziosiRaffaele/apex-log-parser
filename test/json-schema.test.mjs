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
    const compact = runCli([fixturePath, '--compact']);
    assert.equal(compact.stdout.trimEnd().split('\n').length, 1);
    const outputs = {
        default: parseOutput(runCli([fixturePath])),
        withTreeAndContext: parseOutput(runCli([fixturePath, '--include-tree', '--include-context'])),
        withMaxDepth: parseOutput(runCli([fixturePath, '--include-tree', '--max-depth', '2'])),
        nearLimit: parseOutput(runCli([fixturePath, '--near-limit'])),
        hotspots: parseOutput(runCli([fixturePath, '--hotspots'])),
        compact: parseOutput(compact),
    };

    assert.ok(outputs.nearLimit.nearLimitTransactions.length > 0);
    assert.ok(outputs.hotspots.hotspots.length > 0);
    assert.match(JSON.stringify(outputs.withMaxDepth.tree), /"hiddenDescendants":\d+/);
    for (const [name, output] of Object.entries(outputs)) {
        assert.deepEqual(validate(schema, output, schema), [], `${name} output does not match schema`);
    }
    assert.notDeepEqual(validate(schema, { summary: outputs.default.summary }, schema), []);
});
