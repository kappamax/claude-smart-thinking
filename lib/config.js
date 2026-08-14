'use strict';

const paths = require('./paths');
const { readJson, writeJsonAtomic } = require('./jsonio');

const DEFAULTS = {
  // How often Claude Code re-runs the status line script. Seconds, min 1.
  refreshIntervalSeconds: 30,
  // How stale cached content may get before a background refetch is triggered.
  contentMaxAgeMinutes: 20,
  // How many tips to write into settings.json. Claude Code shows the
  // least-recently-shown one, so this is the size of the rotation queue.
  tipCount: 12,

  statusLine: {
    enabled: true,
    // Existing status line to run first; its output becomes line 1.
    // Captured automatically at install time so we never clobber a setup.
    wrap: null,
  },

  spinnerVerbs: {
    enabled: true,
    mode: 'replace',
    verbs: [
      'Thinking', 'Compiling', 'Reasoning', 'Untangling', 'Considering',
      'Wiring', 'Sketching', 'Tracing', 'Weighing', 'Assembling',
    ],
  },

  providers: {
    learn: {
      enabled: true,
      // Cards per refresh drawn from the deck.
      count: 6,
      // Append each card's "learn more" URL to the tip.
      showLinks: true,
      // Ceiling on the share of slots that may go to cards matching the
      // detected stack. Keeps context from crowding out breadth.
      contextShare: 0.4,
    },
    context: {
      enabled: true,
      behindWarnThreshold: 20,
      dirtyWarnThreshold: 25,
      staleHours: 8,
    },
    weather: {
      enabled: false, // needs a location; enable via /thinking-setup
      latitude: null,
      longitude: null,
      units: 'fahrenheit', // or 'celsius'
      // Weather gets promoted to the status line in the window before this.
      leaveForWorkAt: '08:45',
      promoteMinutesBefore: 60,
    },
    news: {
      enabled: false, // needs feeds
      feeds: [],
      maxPerFeed: 3,
      maxAgeHours: 24,
    },
  },
};

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function load() {
  const user = readJson(paths.configFile, null);
  return deepMerge(DEFAULTS, user);
}

function save(cfg) {
  writeJsonAtomic(paths.configFile, cfg);
}

/** Persist only the given patch, leaving the rest of the user's file alone. */
function patch(changes) {
  const existing = readJson(paths.configFile, {}) || {};
  const next = deepMerge(existing, changes);
  save(next);
  return deepMerge(DEFAULTS, next);
}

module.exports = { load, save, patch, DEFAULTS };
