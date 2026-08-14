#!/usr/bin/env node
'use strict';

/**
 * Small operator CLI. Deliberately thin — configuration lives in a plain JSON
 * file the user (or Claude, via the slash commands) can edit directly, so this
 * only covers the actions that need to touch settings.json safely.
 *
 *   node bin/setup.js status     show current state
 *   node bin/setup.js refresh    force a synchronous content refresh
 *   node bin/setup.js on         install the status line
 *   node bin/setup.js off        remove everything this plugin wrote
 */

const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('../lib/paths');
const config = require('../lib/config');
const settings = require('../lib/settings');
const { readJson } = require('../lib/jsonio');

const pluginRoot = path.resolve(__dirname, '..');

function status() {
  const cfg = config.load();
  const cache = readJson(paths.cacheFile, null);
  const live = readJson(paths.settingsFile, {}) || {};

  const ageMin = cache && cache.generatedAt
    ? Math.round((Date.now() - cache.generatedAt) / 60000)
    : null;

  console.log('smart-thinking');
  console.log(`  state dir       ${paths.STATE_DIR}`);
  console.log(`  config          ${paths.configFile}`);
  console.log(`  cache           ${ageMin === null ? 'empty' : `${ageMin}m old, ${(cache.tips || []).length} tips, ${(cache.status || []).length} status`}`);
  console.log(`  status line     ${cfg.statusLine.enabled ? 'enabled' : 'disabled'}${cfg.statusLine.wrap ? ` (wrapping: ${cfg.statusLine.wrap})` : ''}`);
  console.log(`  refreshInterval ${cfg.refreshIntervalSeconds}s`);
  console.log('  providers');
  for (const [name, p] of Object.entries(cfg.providers)) {
    console.log(`    ${name.padEnd(8)} ${p.enabled ? 'on' : 'off'}`);
  }
  console.log('  settings.json');
  console.log(`    statusLine          ${live.statusLine ? live.statusLine.command : '(unset)'}`);
  console.log(`    spinnerTipsOverride ${live.spinnerTipsOverride ? `${live.spinnerTipsOverride.tips.length} tips, excludeDefault=${!!live.spinnerTipsOverride.excludeDefault}` : '(unset)'}`);
  console.log(`    spinnerVerbs        ${live.spinnerVerbs ? `${live.spinnerVerbs.mode}, ${live.spinnerVerbs.verbs.length} verbs` : '(unset)'}`);
}

function refresh() {
  const res = spawnSync(process.execPath, [path.join(pluginRoot, 'bin', 'refresh.js'), '--root', pluginRoot], {
    stdio: 'inherit',
  });
  process.exitCode = res.status ?? 0;
  status();
}

function on() {
  const cfg = config.load();
  config.patch({ statusLine: { enabled: true } });
  settings.installStatusLine({
    pluginRoot,
    refreshInterval: cfg.refreshIntervalSeconds ?? 30,
    capturedWrap: (existing) => {
      if (existing && typeof existing.command === 'string' && !cfg.statusLine.wrap) {
        config.patch({ statusLine: { wrap: existing.command } });
        console.log(`captured existing status line to wrap: ${existing.command}`);
      }
    },
  });
  console.log('status line installed');
}

function off() {
  const cfg = config.load();
  // Hand the user's original status line back rather than leaving them with none.
  const restore = cfg.statusLine.wrap
    ? { type: 'command', command: cfg.statusLine.wrap }
    : null;
  settings.uninstall(restore);
  config.patch({ statusLine: { enabled: false } });
  console.log(restore
    ? `removed; restored previous status line: ${cfg.statusLine.wrap}`
    : 'removed');
  console.log(`a pre-install backup of settings.json is at ${paths.settingsBackup}`);
}

const cmd = process.argv[2] || 'status';
const table = { status, refresh, on, off };
if (!table[cmd]) {
  console.error(`unknown command: ${cmd}\nexpected one of: ${Object.keys(table).join(', ')}`);
  process.exit(2);
}
table[cmd]();
