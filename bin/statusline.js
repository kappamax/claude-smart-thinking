#!/usr/bin/env node
'use strict';

/**
 * The hot path. Claude Code runs this on every status line render and on the
 * refreshInterval timer, so it has a strict rule: never block on the network,
 * never write to disk. It prints from cache and, when that cache is stale,
 * fires a fully detached refresh whose result lands on a later render.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const paths = require('../lib/paths');
const config = require('../lib/config');
const { readJson } = require('../lib/jsonio');

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Run the user's pre-existing status line and reuse its output as line 1. */
function runWrapped(command, stdin) {
  if (!command) return null;
  try {
    const res = spawnSync('/bin/sh', ['-c', command], {
      input: stdin,
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: 1024 * 1024,
    });
    const out = (res.stdout || '').replace(/\s+$/, '');
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Detached so the refresh outlives this render. Without detached+unref the
 * child would be tied to a process Claude Code reaps as soon as it has our
 * stdout, killing the fetch partway through.
 */
function triggerRefresh(pluginRoot, workspace) {
  try {
    const args = [path.join(pluginRoot, 'bin', 'refresh.js'), '--root', pluginRoot];
    // Hand the refresh the workspace Claude Code reported, rather than letting
    // it infer one from cwd — that's what makes context track the session.
    if (workspace) args.push('--cwd', workspace);
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch { /* a failed refresh must never break rendering */ }
}

function pickStatus(items, intervalSec) {
  if (!items || items.length === 0) return null;
  const top = Math.max(...items.map((i) => i.priority ?? 0));
  const tier = items.filter((i) => (i.priority ?? 0) === top);
  // Time-sliced rotation keeps the hot path stateless: no counter to persist,
  // and every render within the same slice agrees on what to show.
  const slice = Math.floor(Date.now() / Math.max(1, intervalSec) / 1000);
  return tier[slice % tier.length];
}

function main() {
  const pluginRoot = path.resolve(__dirname, '..');
  const stdin = readStdin();
  const cfg = config.load();

  const lines = [];
  const wrapped = runWrapped(cfg.statusLine && cfg.statusLine.wrap, stdin);
  if (wrapped) lines.push(wrapped);

  // Claude Code reports the active workspace on stdin; parsing it is what lets
  // the refresh detect the right repo when sessions span multiple directories.
  let workspace = null;
  try {
    const payload = JSON.parse(stdin);
    workspace = (payload.workspace && payload.workspace.current_dir) || null;
  } catch { /* absent or malformed stdin just means we fall back to cwd */ }

  const cache = readJson(paths.cacheFile, null);
  const maxAgeMs = (cfg.contentMaxAgeMinutes ?? 20) * 60 * 1000;
  const age = cache && cache.generatedAt ? Date.now() - cache.generatedAt : Infinity;

  if (age > maxAgeMs) triggerRefresh(pluginRoot, workspace);

  const item = pickStatus(cache && cache.status, cfg.refreshIntervalSeconds ?? 30);
  if (item && item.text) lines.push(`${DIM}${item.text}${RESET}`);

  process.stdout.write(`${lines.join('\n')}\n`);
}

// Claude Code may close the pipe before we finish writing (a fast re-render,
// or the session tearing down). EPIPE surfaces as an async 'error' event on the
// stdout socket, so it escapes the try/catch below and would crash loudly with
// a stack trace where the status line should be.
process.stdout.on('error', (err) => {
  if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) process.exit(0);
  process.exit(0);
});

try {
  main();
} catch {
  // A crash here would blank the user's status line entirely, including the
  // segments they had before installing this plugin. Fail silent instead.
  try { process.stdout.write('\n'); } catch { /* pipe already gone */ }
}
