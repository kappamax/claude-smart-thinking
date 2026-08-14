'use strict';

/**
 * settings.json is a file this plugin does not own. These tests exist because
 * a bug here damages something the user cares about far more than the spinner.
 *
 * paths.js reads CLAUDE_CONFIG_DIR once at require time, so the environment
 * has to be set before anything else is loaded. Node's test runner gives each
 * file its own process, which makes that safe.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-thinking-test-'));
process.env.CLAUDE_CONFIG_DIR = TMP;

const test = require('node:test');
const assert = require('node:assert');
const paths = require('../lib/paths');
const settings = require('../lib/settings');
const { readJson, writeJsonAtomic } = require('../lib/jsonio');

function write(obj) {
  fs.mkdirSync(path.dirname(paths.settingsFile), { recursive: true });
  fs.writeFileSync(paths.settingsFile, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}
function read() {
  return JSON.parse(fs.readFileSync(paths.settingsFile, 'utf8'));
}
function reset() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
}

test('applyContent leaves unrelated settings untouched', () => {
  reset();
  write({ env: { FOO: 'bar' }, permissions: { allow: ['Bash(ls:*)'] }, model: 'opus' });
  settings.applyContent({ tips: ['one', 'two'], verbs: ['Thinking'] });

  const after = read();
  assert.deepStrictEqual(after.env, { FOO: 'bar' }, 'env was modified');
  assert.deepStrictEqual(after.permissions, { allow: ['Bash(ls:*)'] }, 'permissions were modified');
  assert.strictEqual(after.model, 'opus', 'model was modified');
});

test('applyContent writes the schema Claude Code actually validates', () => {
  reset();
  write({});
  settings.applyContent({ tips: ['a'], verbs: ['Thinking', 'Compiling'] });

  const s = read();
  // Docs describe these as string arrays; the compiled Zod schema wants
  // objects, and a bare array is rejected outright.
  assert.deepStrictEqual(s.spinnerTipsOverride, { excludeDefault: true, tips: ['a'] });
  assert.deepStrictEqual(s.spinnerVerbs, { mode: 'replace', verbs: ['Thinking', 'Compiling'] });
  assert.strictEqual(s.spinnerTipsEnabled, true);
});

test('a malformed settings.json aborts the write instead of overwriting it', () => {
  reset();
  const broken = '{ "env": { "FOO": "bar" ';
  write(broken);

  assert.throws(() => settings.applyContent({ tips: ['x'] }), /not valid JSON/);
  assert.strictEqual(fs.readFileSync(paths.settingsFile, 'utf8'), broken,
    'the unparseable file must be left exactly as found');
});

test('an unchanged refresh does not rewrite the file', () => {
  reset();
  write({});
  settings.applyContent({ tips: ['same'], verbs: ['Thinking'] });
  const first = fs.statSync(paths.settingsFile).mtimeMs;

  const changed = settings.applyContent({ tips: ['same'], verbs: ['Thinking'] });
  assert.strictEqual(changed, false, 'no-op write should report no change');
  assert.strictEqual(fs.statSync(paths.settingsFile).mtimeMs, first, 'file was rewritten needlessly');
});

test('a backup of the original is kept before the first write', () => {
  reset();
  write({ env: { ORIGINAL: 'yes' } });
  settings.applyContent({ tips: ['x'] });

  const backup = readJson(paths.settingsBackup, null);
  assert.deepStrictEqual(backup, { env: { ORIGINAL: 'yes' } }, 'pre-install state not preserved');
});

test('the backup is not overwritten by later writes', () => {
  reset();
  write({ env: { ORIGINAL: 'yes' } });
  settings.applyContent({ tips: ['x'] });
  settings.applyContent({ tips: ['y'] });

  assert.deepStrictEqual(readJson(paths.settingsBackup, null), { env: { ORIGINAL: 'yes' } });
});

test('installStatusLine captures an existing status line rather than clobbering it', () => {
  reset();
  write({ statusLine: { type: 'command', command: 'bash ~/.claude/mine.sh' } });

  let captured = null;
  settings.installStatusLine({
    pluginRoot: '/plugins/smart-thinking/0.1.0',
    refreshInterval: 30,
    capturedWrap: (existing) => { captured = existing.command; },
  });

  assert.strictEqual(captured, 'bash ~/.claude/mine.sh', 'previous status line was not captured');
  assert.match(read().statusLine.command, /0\.1\.0\/bin\/statusline\.js/);
});

test('installStatusLine rewrites a stale plugin path on version bump', () => {
  reset();
  write({});
  settings.installStatusLine({ pluginRoot: '/plugins/smart-thinking/0.1.0', refreshInterval: 30 });
  settings.installStatusLine({ pluginRoot: '/plugins/smart-thinking/0.2.0', refreshInterval: 30 });

  // CLAUDE_PLUGIN_ROOT is version-stamped, so this self-heal is what keeps the
  // status line working after an update.
  assert.match(read().statusLine.command, /0\.2\.0/);
});

test('installStatusLine does not re-capture its own command as a wrap', () => {
  reset();
  write({});
  settings.installStatusLine({ pluginRoot: '/plugins/x/0.1.0', refreshInterval: 30 });

  let captured = null;
  settings.installStatusLine({
    pluginRoot: '/plugins/x/0.2.0',
    refreshInterval: 30,
    capturedWrap: (e) => { captured = e; },
  });
  assert.strictEqual(captured, null, 'wrapping our own status line would nest it infinitely');
});

test('uninstall removes our keys and restores the previous status line', () => {
  reset();
  write({ env: { KEEP: 'me' } });
  settings.applyContent({ tips: ['x'], verbs: ['Thinking'] });
  settings.uninstall({ type: 'command', command: 'bash ~/.claude/mine.sh' });

  const s = read();
  assert.strictEqual(s.spinnerTipsOverride, undefined);
  assert.strictEqual(s.spinnerVerbs, undefined);
  assert.strictEqual(s.spinnerTipsEnabled, undefined);
  assert.strictEqual(s.statusLine.command, 'bash ~/.claude/mine.sh');
  assert.deepStrictEqual(s.env, { KEEP: 'me' }, 'uninstall must not touch anything else');
});

test('readJson distinguishes a missing file from a broken one', () => {
  reset();
  assert.strictEqual(readJson(path.join(TMP, 'nope.json'), null), null, 'missing should use fallback');

  const bad = path.join(TMP, 'bad.json');
  fs.writeFileSync(bad, '{oops');
  assert.throws(() => readJson(bad, {}), /not valid JSON/,
    'a broken file must never be silently treated as empty');
});

test('writeJsonAtomic leaves no temp files behind', () => {
  reset();
  const target = path.join(TMP, 'out.json');
  writeJsonAtomic(target, { a: 1 });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { a: 1 });
  assert.deepStrictEqual(fs.readdirSync(TMP).filter((f) => f.includes('.tmp')), []);
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
