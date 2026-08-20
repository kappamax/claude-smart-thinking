'use strict';

/**
 * One place that decides how an item looks on screen.
 *
 * Claude Code prepends its own "Tip: " to every custom tip and that isn't
 * removable, so anything we add on top has to earn its width. The old format
 * spent it badly:
 *
 *   Tip: Git — `git reflog` records ... → https://git-scm.com/docs/git-reflog
 *        └┬┘ └┬┘                          └──────────────┬──────────────────┘
 *      category │                                   raw URL, unclickable text
 *          redundant separator
 *
 * Now: one category, one thin separator, and the text itself is the link.
 *
 *   Tip: Git · `git reflog` records every HEAD move for ~90 days ...
 */

const SEP = ' · ';

// Terminals known to render OSC 8. Everything else gets a plain URL appended,
// because an unsupported terminal prints the escape sequence as visible junk.
const HYPERLINK_TERMS = new Set([
  'iTerm.app', 'WezTerm', 'ghostty', 'vscode', 'Hyper', 'rio', 'kitty', 'Tabby',
]);

function terminalSupportsHyperlinks(env = process.env) {
  if (env.FORCE_HYPERLINK === '0') return false;
  if (env.FORCE_HYPERLINK) return true;
  // kitty and a few others advertise via TERM rather than TERM_PROGRAM.
  if (env.TERM && /kitty|wezterm|ghostty/i.test(env.TERM)) return true;
  return HYPERLINK_TERMS.has(env.TERM_PROGRAM || '');
}

/**
 * OSC 8: ESC ] 8 ;; URL ST  text  ESC ] 8 ;; ST
 * Using BEL (\x07) as the terminator — the most widely accepted form.
 */
function osc8(text, url) {
  return `]8;;${url}${text}]8;;`;
}

/**
 * A hyperlink with no visible marker is a link nobody clicks.
 *
 * Hiding the URL saved a lot of width, but it also removed the only cue that
 * there was anything more to read — the text became silently clickable, which
 * reads as a dead end. The hint restores the affordance for about two columns:
 * a trailing marker, inside the link, so clicking it works too.
 *
 * Not needed in url mode, where the visible URL is its own affordance.
 */
const DEFAULT_HINT = '↗';

/**
 * Link colour.
 *
 * Terminal hyperlinks are invisible by default — OSC 8 makes text clickable
 * without changing how it looks, which is why a hidden URL reads as a dead
 * end. Claude Code colours its own links blue, so matching that is the
 * clearest signal available.
 *
 * Reset uses 39 (default foreground) rather than 0, because 0 would also clear
 * the dim attribute the surrounding line may be using.
 */
const COLORS = {
  blue: '\x1b[34m',
  brightBlue: '\x1b[94m',
  cyan: '\x1b[36m',
  none: null,
};
const FG_RESET = '\x1b[39m';

function colorize(text, color) {
  const code = COLORS[color];
  return code ? `${code}${text}${FG_RESET}` : text;
}

/**
 * @param {object} item  {category, text, url}
 * @param {string} style 'auto' | 'hyperlink' | 'url' | 'none'
 * @param {object} env
 * @param {string|null} hint  marker appended inside the link; null to omit
 * @param {string} color  key of COLORS applied to the linked text
 */
function formatTip(item, style = 'auto', env = process.env, hint = DEFAULT_HINT, color = 'none') {
  const category = item.category ? `${item.category}${SEP}` : '';
  const url = item.url;

  /**
   * Mechanism, then what to do about it.
   *
   * A card that explains starch retrogradation and stops has told the reader
   * something true and left them holding it. The action is what converts a
   * fact into a change in behaviour, and it's the difference between this
   * surface teaching someone and merely informing them. Marked with a
   * separate glyph so the eye can find it without reading the whole line.
   */
  const text = item.action ? `${item.text} ▸ ${item.action}` : (item.text || '');

  if (!url || style === 'none') return `${category}${text}`;

  const useLink = style === 'hyperlink'
    || (style === 'auto' && terminalSupportsHyperlinks(env));

  // The category stays outside the link so the clickable region is the claim
  // itself, which is what the reader is deciding whether to follow.
  if (useLink) {
    const marked = hint ? `${text} ${hint}` : text;
    // Colour wraps the OSC 8 sequence so the visible label is tinted while the
    // escape itself stays intact.
    return `${category}${colorize(osc8(marked, url), color)}`;
  }
  // In url mode only the url is tinted — colouring the whole claim would make
  // the line harder to read, not easier.
  return `${category}${text} → ${colorize(url, color)}`;
}

/**
 * Durations the way a person says them.
 *
 * The rule is that precision drops as magnitude grows, because that is how
 * people actually speak. Nobody says "23 hours 59 minutes ago" — they say "a
 * day ago". Nobody says "1 hour 47 minutes" either; they round to the nearest
 * quarter or five minutes without thinking about it.
 *
 * So the value is rounded to a human granularity *before* it is bucketed, and
 * the rounding is allowed to carry upward across a boundary. That is what
 * turns 23h 59m into "1d" rather than reporting it to the minute.
 *
 *   under a minute · 45m · 1h 45m · 2h · 23h 45m · 1d · 1d 2h · 3d
 */
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'under a minute';
  if (ms < 30 * 1000) return 'under a minute';

  // Below an hour, the nearest minute is how people speak.
  if (ms < HOUR - 30 * 1000) {
    const mins = Math.max(1, Math.round(ms / MIN));
    return `${mins}m`;
  }

  // Between an hour and a day, the nearest five minutes. Rounding carries:
  // 23h 59m lands on 24h and is then reported as a day, not to the minute.
  const roundedToFive = Math.round(ms / (5 * MIN)) * 5 * MIN;
  if (roundedToFive < DAY) {
    const hours = Math.floor(roundedToFive / HOUR);
    const mins = Math.round((roundedToFive % HOUR) / MIN);
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
  }

  // A day or more: minutes stop being something anyone says out loud.
  const roundedToHour = Math.round(roundedToFive / HOUR) * HOUR;
  const days = Math.floor(roundedToHour / DAY);
  const hours = Math.round((roundedToHour % DAY) / HOUR);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

/** Convenience for the many callers that already hold hours. */
function formatHours(hours) {
  return formatDuration(hours * 3600000);
}

module.exports = {
  formatTip, osc8, terminalSupportsHyperlinks, SEP, DEFAULT_HINT,
  formatDuration, formatHours, colorize, COLORS,
};
