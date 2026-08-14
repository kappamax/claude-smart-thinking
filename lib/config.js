'use strict';

const paths = require('./paths');
const { readJson, writeJsonAtomic } = require('./jsonio');

const DEFAULTS = {
  // How often Claude Code re-runs the status line script. Seconds, min 1.
  refreshIntervalSeconds: 30,
  // How stale cached content may get before a background *network* refetch.
  contentMaxAgeMinutes: 20,
  // How many tips to write into settings.json at a time.
  tipCount: 12,

  /**
   * How often to re-deal the tips from the cached pool. No network — this just
   * rewrites settings.json from content already fetched, so it can run far
   * more often than contentMaxAgeMinutes.
   *
   * This is what actually makes tips alternate. Claude Code scores tips by
   * `numStartups - tipsHistory[id]`, which is a count of app startups, not
   * time. Within one session that number is frozen, so once every tip has been
   * shown once they all score 0, the tie-break is equal, and the picker keeps
   * returning the first element of the array. Since tip ids are positional
   * (custom-tip-0..N), re-dealing which content sits at each index is what
   * changes the text on screen.
   */
  rotateIntervalSeconds: 90,
  // Items to keep cached so rotation has somewhere to draw from.
  poolSize: 60,

  /**
   * How links are rendered: 'auto' | 'hyperlink' | 'url' | 'none'.
   * 'auto' emits an OSC 8 terminal hyperlink when the terminal is known to
   * support it, so the text itself is clickable and the URL never takes up
   * width; otherwise it falls back to appending the plain URL.
   */
  linkStyle: 'auto',

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
      // Cards drawn into the rotation pool per network refresh. Larger than
      // what's visible at once, so rotation has fresh material to deal.
      count: 30,
      // Append each card's "learn more" URL to the tip.
      showLinks: true,
      // Ceiling on the share of slots that may go to cards matching the
      // detected stack. Keeps context from crowding out breadth.
      contextShare: 0.4,
    },
    wellness: {
      enabled: true,
      sleep: true,
      movement: true,
      lateNightStartHour: 22,
      lateNightEndHour: 5,
      sleepTipCount: 4,
      sleepWarnHours: 7,
      wakeTime: '07:00',
      breakAfterHours: 1.5,
    },
    context: {
      enabled: true,
      introspect: true,
      introspectDirtyThreshold: 10,
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
