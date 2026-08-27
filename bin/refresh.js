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
const { formatTip, categoryColorMap } = require('../lib/format');

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

function shouldWriteClaudeSettings(argv) {
  return !argv.includes('--no-settings');
}

/**
 * Re-deal the visible tips from the cached pool. No network.
 *
 * This is what makes tips actually alternate. Claude Code scores tips by
 * app-startup count, so within one session that score is frozen — once every
 * tip has been shown the picker returns the first array element forever.
 * Since tip ids are positional, changing which pool item sits at each index
 * changes what's on screen even in that stuck state.
 */
function rotate(cfg) {
  const cache = readJson(paths.cacheFile, null);
  const pool = (cache && cache.pool) || [];
  if (pool.length === 0) return false;

  const count = Math.min(cfg.tipCount || 12, pool.length);
  const offset = ((cache.rotationOffset || 0) + count) % pool.length;

  const dealt = [];
  for (let i = 0; i < count; i += 1) dealt.push(pool[(offset + i) % pool.length]);

  writeJsonAtomic(paths.cacheFile, { ...cache, rotationOffset: offset, rotatedAt: Date.now() });

  const style = cfg.linkStyle || 'auto';
  // Built from the whole pool, not just what's visible, so a category keeps its
  // colour across rotations instead of changing every 30 seconds.
  const categoryColors = categoryColorMap(pool.map((t) => t.category));
  if (shouldWriteClaudeSettings(process.argv)) {
    settings.applyContent({
      tips: dealt.map((t) => formatTip(t, style, process.env, undefined, cfg.linkColor || 'none', {
        categoryColor: cfg.categoryColor !== false,
        italicAction: cfg.italicAction !== false,
        categoryColors,
      })),
      verbs: cfg.spinnerVerbs && cfg.spinnerVerbs.enabled ? cfg.spinnerVerbs.verbs : null,
    });
  }
  return true;
}

async function main() {
  const pluginRoot = pluginRootFrom(process.argv);
  if (!acquireLock()) return;

  if (process.argv.includes('--rotate')) {
    try {
      const cfg = config.load();
      const ok = rotate(cfg);
      log(`rotate ${ok ? 'ok' : 'skipped (empty pool)'}`);
    } catch (err) {
      log(`rotate failed: ${err && err.message}`);
    } finally {
      releaseLock();
    }
    return;
  }

  try {
    const cfg = config.load();
    // The workspace dir comes from the status line's stdin payload when it
    // spawns us; the SessionStart hook already runs in the project directory.
    const workspace = argValue(process.argv, '--cwd') || process.cwd();
    const ctx = {
      pluginRoot,
      now: new Date(),
      context: context.detect(workspace),
      activity: {
        sessionId: argValue(process.argv, '--session'),
        cost: Number(argValue(process.argv, '--cost')) || 0,
        apiMs: Number(argValue(process.argv, '--api-ms')) || 0,
        idleResetMinutes: cfg.providers && cfg.providers.wellness
          ? cfg.providers.wellness.idleResetMinutes : undefined,
      },
    };
    const { tips, status, errors } = await collectAll(cfg, ctx);
    for (const e of errors) log(`provider-error ${e}`);

    // Nothing came back at all — keep the previous cache rather than blanking
    // the spinner. Stale content beats empty content on this surface.
    if (tips.length === 0 && status.length === 0) {
      log('refresh produced no items; retaining previous cache');
      return;
    }

    const previous = readJson(paths.cacheFile, {}) || {};
    // Keep a pool far larger than what's shown, so rotation has room to draw
    // from without going back to the network.
    const pool = interleave(tips, cfg.poolSize || 60);
    const visible = pool.slice(0, cfg.tipCount || 12);

    writeJsonAtomic(paths.cacheFile, {
      generatedAt: Date.now(),
      rotatedAt: Date.now(),
      rotationOffset: 0,
      pool: pool.length ? pool : previous.pool || [],
      status: status.length ? status : previous.status || [],
    });

    const style = cfg.linkStyle || 'auto';
    const categoryColors = categoryColorMap(pool.map((t) => t.category));
    const applied = shouldWriteClaudeSettings(process.argv) && settings.applyContent({
      tips: visible.map((t) => formatTip(t, style, process.env, undefined, cfg.linkColor || 'none', {
        categoryColor: cfg.categoryColor !== false,
        italicAction: cfg.italicAction !== false,
        categoryColors,
      })),
      verbs: cfg.spinnerVerbs && cfg.spinnerVerbs.enabled ? cfg.spinnerVerbs.verbs : null,
    });

    const topics = [...ctx.context.topics].sort().join(',') || 'none';
    log(`refresh ok pool=${pool.length} shown=${visible.length} status=${status.length} settingsWritten=${applied} topics=${topics}`);
  } catch (err) {
    log(`refresh failed: ${err && err.stack ? err.stack : err}`);
    process.exitCode = 1;
  } finally {
    releaseLock();
  }
}

main();
