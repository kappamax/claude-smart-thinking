#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('../lib/paths');
const config = require('../lib/config');
const settings = require('../lib/settings');
const context = require('../lib/context');
const { readJson, writeJsonAtomic } = require('../lib/jsonio');
const { collectAll, interleave } = require('../providers');

const LOCK_STALE_MS = 2 * 60 * 1000;

/**
 * Single-writer lock. The status line fires this detached on a timer and the
 * SessionStart hook fires it too, so several Claude Code windows can race. Two
 * refreshes racing would interleave writes to the same settings.json.
 */
function acquireLock() {
  fs.mkdirSync(paths.STATE_DIR, { recursive: true });
  try {
    fs.writeFileSync(paths.lockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // Reclaim a lock left behind by a killed process.
    try {
      const age = Date.now() - fs.statSync(paths.lockFile).mtimeMs;
      if (age > LOCK_STALE_MS) {
        fs.unlinkSync(paths.lockFile);
        fs.writeFileSync(paths.lockFile, String(process.pid), { flag: 'wx' });
        return true;
      }
    } catch { /* lost the race to another reclaimer; just skip this run */ }
    return false;
  }
}

function releaseLock() {
  try { fs.unlinkSync(paths.lockFile); } catch { /* already gone */ }
}

function log(msg) {
  try {
    fs.mkdirSync(paths.STATE_DIR, { recursive: true });
    fs.appendFileSync(paths.logFile, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* logging must never break a refresh */ }
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
}

function pluginRootFrom(argv) {
  return argValue(argv, '--root') || path.resolve(__dirname, '..');
}

async function main() {
  const pluginRoot = pluginRootFrom(process.argv);
  if (!acquireLock()) return;

  try {
    const cfg = config.load();
    // The workspace dir comes from the status line's stdin payload when it
    // spawns us; the SessionStart hook already runs in the project directory.
    const workspace = argValue(process.argv, '--cwd') || process.cwd();
    const ctx = { pluginRoot, now: new Date(), context: context.detect(workspace) };
    const { tips, status, errors } = await collectAll(cfg, ctx);
    for (const e of errors) log(`provider-error ${e}`);

    // Nothing came back at all — keep the previous cache rather than blanking
    // the spinner. Stale content beats empty content on this surface.
    if (tips.length === 0 && status.length === 0) {
      log('refresh produced no items; retaining previous cache');
      return;
    }

    const previous = readJson(paths.cacheFile, {}) || {};
    const orderedTips = interleave(tips, cfg.tipCount || 12);

    writeJsonAtomic(paths.cacheFile, {
      generatedAt: Date.now(),
      tips: orderedTips.length ? orderedTips : previous.tips || [],
      status: status.length ? status : previous.status || [],
    });

    const applied = settings.applyContent({
      tips: orderedTips.map((t) => t.text),
      verbs: cfg.spinnerVerbs && cfg.spinnerVerbs.enabled ? cfg.spinnerVerbs.verbs : null,
    });

    const topics = [...ctx.context.topics].sort().join(',') || 'none';
    log(`refresh ok tips=${orderedTips.length} status=${status.length} settingsWritten=${applied} topics=${topics}`);
  } catch (err) {
    log(`refresh failed: ${err && err.stack ? err.stack : err}`);
    process.exitCode = 1;
  } finally {
    releaseLock();
  }
}

main();
