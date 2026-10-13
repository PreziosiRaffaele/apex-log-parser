import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = resolve(repoRoot, 'dist/cli.js');
const skillPath = resolve(repoRoot, 'skills/apex-log-parser/SKILL.md');
const fixturePath = resolve(repoRoot, 'test/fixtures/triage.log');

function runCli(args) {
    return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
}

const hasJq = spawnSync('jq', ['--version']).status === 0;

function skillCommands() {
    const skill = readFileSync(skillPath, 'utf8');
    const blocks = [...skill.matchAll(/```bash\n([\s\S]*?)```/g)].map(match => match[1]);
    return blocks.flatMap(block => block.split('\n')).filter(line => line.startsWith('apex-log-parser '));
}

// Splits the CLI part of a documented command (before any jq pipe) into argv, substituting the fixture for log paths.
function cliArgs(command) {
    const cliPart = command.split(' | ')[0];
    return cliPart.split(/\s+/).slice(1).map(arg => (/\.log$/.test(arg) ? fixturePath : arg));
}

test('--skill prints the packaged SKILL.md with name and description frontmatter', () => {
    const result = runCli(['--skill']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, readFileSync(skillPath, 'utf8'));
    assert.match(result.stdout, /^---\nname: apex-log-parser\ndescription: .+\n---\n/);

    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
    assert.ok(packageJson.files.includes('skills/**/*'));
});

test('every apex-log-parser command in SKILL.md runs successfully on the triage fixture', () => {
    const commands = skillCommands();
    assert.ok(commands.length >= 10);

    for (const command of commands) {
        const result = runCli(cliArgs(command));
        assert.equal(result.status, 0, `${command}\n${result.stderr}`);
        assert.equal(result.stderr, '', command);
        assert.notEqual(result.stdout.trim(), '', command);
    }
});

test('every SKILL.md command pipeline, including jq, succeeds on the triage fixture', { skip: !hasJq && 'jq not installed' }, () => {
    const binDir = mkdtempSync(join(tmpdir(), 'apex-log-parser-skill-'));
    try {
        const wrapper = join(binDir, 'apex-log-parser');
        writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} "$@"\n`);
        chmodSync(wrapper, 0o755);
        const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}` };

        for (const command of skillCommands()) {
            const pipeline = command.replace(/(?:my|logs\/\*)\.log/g, JSON.stringify(fixturePath));
            const result = spawnSync('bash', ['-o', 'pipefail', '-c', pipeline], { encoding: 'utf8', env });
            assert.equal(result.status, 0, `${command}\n${result.stderr}`);
            assert.equal(result.stderr, '', command);
            const lines = result.stdout.split('\n').filter(line => line.trim() !== '');
            assert.ok(lines.length > 0, command);
            assert.ok(lines.some(line => line.trim() !== 'null'), `${command} printed only null`);
        }
    } finally {
        rmSync(binDir, { recursive: true, force: true });
    }
});
