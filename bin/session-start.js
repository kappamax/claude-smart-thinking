#!/usr/bin/env node
'use strict';

/**
 * SessionStart hook. Two jobs, both silent:
 *
 *  1. Re-point statusLine at this plugin's current install directory.
 *     ${CLAUDE_PLUGIN_ROOT} is version-stamped, so the absolute path written
 *     into settings.json goes stale on every plugin update. Rewriting it each
 *     session is what makes updates self-healing.
 *  2. Kick off a detached content refresh so the first render has fresh data.
 *
 * Prints nothing. SessionStart stdout becomes model context, and spending
 * tokens to announce a spinner refresh would defeat the point of the plugin.
 */

const path = require('path');
const { spawn } = require('child_process');
const config = require('../lib/config');
const settings = require('../lib/settings');

function pluginRootFrom(argv) {
  const i = argv.indexOf('--root');
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return path.resolve(__dirname, '..');
}

function main() {
  const pluginRoot = pluginRootFrom(process.argv);
  const cfg = config.load();

  if (cfg.statusLine && cfg.statusLine.enabled) {
    settings.installStatusLine({
      pluginRoot,
      refreshInterval: cfg.refreshIntervalSeconds ?? 30,
      // Runs only when an existing, non-ours status line is found — i.e. once,
      // on first install. Persisting it here is what lets us compose with the
      // user's setup instead of replacing it.
      capturedWrap: (existing) => {
        if (!existing || typeof existing.command !== 'string') return;
        if (cfg.statusLine.wrap) return; // already captured
        config.patch({ statusLine: { wrap: existing.command } });
      },
    });
  }

  const child = spawn(process.execPath, [path.join(pluginRoot, 'bin', 'refresh.js'), '--root', pluginRoot], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

try {
  main();
} catch {
  // Never fail a session start over spinner decoration.
  process.exitCode = 0;
}
