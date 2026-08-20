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
  /**
   * 90s, deliberately not faster.
   *
   * 30s was tried and it turns the surface into something you have to keep up
   * with — a tip you were halfway through reading is replaced before you finish
   * it. The point is to fill idle attention, not to compete for it.
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
  /**
   * Colour applied to the link: 'blue' | 'brightBlue' | 'cyan' | 'none'.
   * Terminal hyperlinks are otherwise invisible, so this is what makes them
   * look clickable rather than merely being clickable.
   */
  linkColor: 'none',
  // A stable colour per category, so the label reads as a visual index rather
  // than decoration — the same topic is always the same hue.
  categoryColor: true,
  // Italicise the action, so the instruction separates from the mechanism
  // without spending a second colour on it.
  italicAction: true,

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
      // Non-sleep health claims drawn into the pool on every refresh, so
      // health competes for slots all day rather than only after a break.
      dayTipCount: 3,
      // A gap this long between working ticks starts the counter over.
      idleResetMinutes: 30,
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
    literature: {
      /**
       * Off by default, after two failed attempts to make it good.
       *
       * The unit is the problem, not the source. A paper title is not a
       * finding: Cochrane titles are deliberately non-committal ("Physical
       * activity for the management of obesity in adolescents aged 10 to 19
       * years") because the conclusion lives in the abstract. Filtering by
       * journal removed the junk and still left titles nobody can learn from.
       *
       * What makes the curated corpus work is that someone read the paper and
       * wrote down the finding and what to do about it. That judgement cannot
       * happen at render time in a background refresh. It belongs in
       * /thinking-research, where the reading happens once and the result is a
       * graded corpus entry.
       */
      enabled: false,
      topics: ['sleep', 'nutrition', 'exercise', 'cognition', 'longevity'],
      perTopic: 2,
      maxAgeDays: 60,
    },
    news: {
      // Off by default: a headline cannot meet a peer-reviewed bar.
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
