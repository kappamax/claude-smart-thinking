'use strict';

/**
 * Manifest invariants.
 *
 * `claude plugin validate` passes a manifest that Claude Code then refuses to
 * load, so validation alone is not enough. These cover the failure that
 * actually shipped and the version drift that would silently withhold an
 * update from everyone who installed it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
const market = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
const entry = market.plugins.find((p) => p.name === plugin.name);

test('the manifest does not redeclare the standard hooks file', () => {
  // Regression: `"hooks": "./hooks/hooks.json"` made Claude Code load the
  // standard file twice and refuse the plugin entirely:
  //   "Duplicate hooks file detected ... The standard hooks/hooks.json is
  //    loaded automatically."
  // manifest.hooks is only for hook files beyond the default one.
  const declared = plugin.hooks;
  if (!declared) return;
  const paths = Array.isArray(declared) ? declared : [declared];
  for (const p of paths) {
    assert.notStrictEqual(
      path.normalize(String(p)), path.normalize('./hooks/hooks.json'),
      'hooks/hooks.json loads automatically; declaring it again breaks the plugin',
    );
  }
});

test('the standard hooks file exists and is valid', () => {
  const hooksPath = path.join(ROOT, 'hooks/hooks.json');
  assert.ok(fs.existsSync(hooksPath), 'the hook is what schedules every refresh');
  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  assert.ok(hooks.hooks.SessionStart, 'SessionStart is what self-heals the status line path');
});

test('plugin and marketplace versions agree', () => {
  // Both pin the plugin. If they drift, installs resolve to one version while
  // the update check reads the other, and users silently never receive it.
  assert.ok(entry, `no marketplace entry named ${plugin.name}`);
  assert.strictEqual(entry.version, plugin.version,
    `plugin.json is ${plugin.version} but marketplace.json says ${entry.version}`);
});

test('the marketplace entry points at the repo root', () => {
  assert.strictEqual(entry.source, './', 'the marketplace-root layout expects source "./"');
});

test('every script the manifest and commands reference exists', () => {
  const referenced = new Set();
  const scan = (text) => {
    // The trailing boundary matters: without it, ".js" matches inside
    // "deck.sample.json" and the check hunts for a file that never existed.
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+\.js)(?![\w])/g)) referenced.add(m[1]);
  };
  scan(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
  for (const f of fs.readdirSync(path.join(ROOT, 'commands'))) {
    scan(fs.readFileSync(path.join(ROOT, 'commands', f), 'utf8'));
  }
  assert.ok(referenced.size > 0, 'expected the hook and commands to reference scripts');
  for (const rel of referenced) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `referenced but missing: ${rel}`);
  }
});

test('no runtime state is shipped inside the plugin directory', () => {
  // CLAUDE_PLUGIN_ROOT is version-stamped and reaped after an update, so
  // anything durable living here would be silently lost.
  for (const name of ['cache.json', 'config.json', 'deck.json', 'learn-state.json', 'refresh.log']) {
    assert.ok(!fs.existsSync(path.join(ROOT, name)), `${name} must live in ~/.claude/smart-thinking/`);
  }
});

test('every test file parses, so none is silently skipped', () => {
  // `node --test` reports a lower test count when a file throws at load rather
  // than failing loudly — a duplicate const once dropped 26 tests and the run
  // still looked almost green.
  const { execFileSync } = require('child_process');
  const dir = path.join(ROOT, 'test');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js'));
  assert.ok(files.length >= 5, `expected the full suite, found ${files.length} files`);
  for (const f of files) {
    execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' });
  }
});

test('the freshness loop invokes a real command with a real bundle', () => {
  // harvest.sh is the only thing bridging "new material exists" and "a card
  // exists". If it referenced a command or bundle that had been renamed, the
  // cron would fail silently at 7am on a Monday and nobody would notice the
  // deck had stopped growing.
  const sh = fs.readFileSync(path.join(ROOT, 'bin/harvest.sh'), 'utf8');
  for (const cmd of ['thinking-digest', 'thinking-research']) {
    assert.ok(sh.includes(`/${cmd}`), `harvest.sh references /${cmd}`);
    assert.ok(fs.existsSync(path.join(ROOT, 'commands', `${cmd}.md`)), `${cmd} command missing`);
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/feeds.catalog.json'), 'utf8'));
  const fallback = /thinking-digest \$\{ARG:-(\w[\w-]*)\}/.exec(sh);
  assert.ok(fallback, 'could not find the default bundle in harvest.sh');
  assert.ok(catalog.bundles[fallback[1]],
    `default bundle "${fallback[1]}" is not in the catalog`);
});

test('the scheduled cron line does not reference a versioned plugin path', () => {
  // ${CLAUDE_PLUGIN_ROOT} is version-stamped and reaped after an update. A
  // cron entry pointing into it would fail silently and the only symptom would
  // be a deck that stopped growing — the same trap the status line hits, which
  // is why the SessionStart hook rewrites that path every session. Cron has no
  // such hook, so the line must not depend on the path at all.
  // Check the generated line, not the surrounding source. The first version
  // grepped the whole install block and flagged the comment that explains why
  // the path is avoided — the code was correct and the test was reading prose.
  const sh = fs.readFileSync(path.join(ROOT, 'bin/harvest.sh'), 'utf8');
  const lineAssign = /^\s*LINE="(.+)"$/m.exec(sh);
  assert.ok(lineAssign, 'could not find the cron LINE assignment');
  const line = lineAssign[1];

  assert.ok(!/plugins\/cache|CLAUDE_PLUGIN_ROOT|BASH_SOURCE|HERE/.test(line),
    `the cron line must not reference the plugin directory: ${line}`);
  assert.ok(/claude -p/.test(line), 'it should invoke the slash command directly');
  assert.ok(/< \/dev\/null/.test(line), 'cron has no stdin — close it explicitly');
  // The marker is interpolated from $MARKER at runtime, so the literal string
  // is not in the assignment — check the reference, and separately that the
  // variable holds what uninstall greps for.
  assert.ok(/\$MARKER\s*$/.test(line), 'the line must end with the marker so uninstall can find it');
  assert.match(sh, /MARKER="# smart-thinking-harvest"/, 'the marker must be the string uninstall greps for');
});
