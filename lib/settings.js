'use strict';

const fs = require('fs');
const paths = require('./paths');
const { readJson, writeJsonAtomic } = require('./jsonio');

// The only keys this plugin will ever touch in the user's settings.json.
const OWNED_KEYS = ['spinnerTipsOverride', 'spinnerVerbs', 'spinnerTipsEnabled', 'statusLine'];

/**
 * Verified against the Zod schema compiled into Claude Code v2.1.226:
 *
 *   spinnerTipsEnabled:  boolean
 *   spinnerVerbs:        { mode: "append"|"replace", verbs: string[] }
 *   spinnerTipsOverride: { excludeDefault?: boolean, tips: string[] }
 *   statusLine:          { type:"command", command, padding?, refreshInterval? }
 *
 * The published settings docs describe spinnerTipsOverride/spinnerVerbs as
 * plain string arrays. That is stale; a bare array is rejected by the schema.
 */

function backupOnce() {
  if (fs.existsSync(paths.settingsBackup)) return;
  const current = readJson(paths.settingsFile, null);
  if (current === null) return;
  writeJsonAtomic(paths.settingsBackup, current);
}

/**
 * Read settings, apply `mutate`, write back atomically. Every other key in the
 * file is preserved byte-for-byte in value; we only ever reassign OWNED_KEYS.
 */
function updateSettings(mutate) {
  // Throws on malformed JSON, which aborts before any write. Better to leave
  // the spinner un-personalized than to flatten a settings file we misread.
  const settings = readJson(paths.settingsFile, {}) || {};
  backupOnce();

  const before = JSON.stringify(pick(settings, OWNED_KEYS));
  mutate(settings);
  const after = JSON.stringify(pick(settings, OWNED_KEYS));
  if (before === after) return false; // no-op: skip the write entirely

  writeJsonAtomic(paths.settingsFile, settings);
  return true;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** Push generated content into the spinner surfaces. */
function applyContent({ tips, verbs }) {
  return updateSettings((s) => {
    if (Array.isArray(tips) && tips.length > 0) {
      s.spinnerTipsOverride = { excludeDefault: true, tips };
      // excludeDefault:true makes Claude Code return ONLY these tips, skipping
      // both the built-in tips and marketplace plugin-advertisement tips.
      s.spinnerTipsEnabled = true;
    }
    if (Array.isArray(verbs) && verbs.length > 0) {
      s.spinnerVerbs = { mode: 'replace', verbs };
    }
  });
}

/**
 * Point statusLine at this plugin's wrapper.
 *
 * ${CLAUDE_PLUGIN_ROOT} is version-stamped and changes on every plugin update,
 * so the absolute path baked in here goes stale. The SessionStart hook re-runs
 * this every session, which self-heals the path after an update.
 *
 * If the user already had a statusLine that isn't ours, we capture it as
 * `wrap` so its output is preserved as the first line rather than clobbered.
 */
function installStatusLine({ pluginRoot, refreshInterval, capturedWrap }) {
  return updateSettings((s) => {
    const command = `node "${pluginRoot}/bin/statusline.js"`;
    const existing = s.statusLine;
    const isOurs = existing && typeof existing.command === 'string'
      && existing.command.includes('bin/statusline.js');

    if (existing && !isOurs && capturedWrap) capturedWrap(existing);

    s.statusLine = {
      type: 'command',
      command,
      refreshInterval,
      ...(existing && existing.padding !== undefined ? { padding: existing.padding } : {}),
    };
  });
}

/** Remove everything this plugin set, restoring a wrapped statusLine if present. */
function uninstall(restoreStatusLine) {
  return updateSettings((s) => {
    delete s.spinnerTipsOverride;
    delete s.spinnerVerbs;
    delete s.spinnerTipsEnabled;
    if (restoreStatusLine) s.statusLine = restoreStatusLine;
    else delete s.statusLine;
  });
}

module.exports = { updateSettings, applyContent, installStatusLine, uninstall, OWNED_KEYS };
