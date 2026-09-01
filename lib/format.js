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
 * Colour that survives being wrapped.
 *
 * A single leading SGR code is terminal *state*, so it normally carries across
 * a line break. It does not survive a renderer that measures the string, splits
 * it into lines and emits each one separately — the escape only exists on the
 * first line, so every continuation line renders in the default colour. That is
 * exactly what happens to a long tip.
 *
 * Re-applying the code on every word means whatever point the wrap lands on,
 * the next line still opens with an active colour. The escapes carry no display
 * width, so nothing shifts; the string just gets longer.
 */
function colorizeWrapSafe(text, color) {
  return sgrWrapSafe(text, COLORS[color], FG_RESET);
}

/**
 * Apply any SGR sequence so it survives being wrapped.
 *
 * Same reasoning as the colour case: the escape is terminal state, and a
 * renderer that splits the string into lines leaves every line after the first
 * without it. Re-applying per word costs nothing visible, since escapes carry
 * no display width.
 */
function sgrWrapSafe(text, open, close) {
  if (!open) return text;
  const painted = text.split(' ').map((w) => (w ? `${open}${w}` : w)).join(' ');
  return `${painted}${close}`;
}

const ITALIC = '\x1b[3m';
const ITALIC_OFF = '\x1b[23m';

/**
 * A stable colour per category, so the label becomes a visual index.
 *
 * The point is recognition rather than decoration: Sleep is always the same
 * hue, Bread always another, so the eye can classify the tip before reading a
 * word of it. Assignment is by hash of the category name so it stays fixed as
 * categories come and go, and so two people see the same thing.
 *
 * 256-colour codes; every one chosen to stay legible on both a dark and a light
 * background, which rules out the darkest and lightest ends of the cube.
 */
const CATEGORY_PALETTE = [
  118, 141, 80, 214, 211, 221, 79, 203, 111, 180, 156, 175,
  115, 147, 209, 78, 176, 179, 116, 183, 210, 149, 117, 219,
  120, 138, 208, 81, 170, 186, 114, 168,
];

function code256(n) {
  return `\x1b[38;5;${n}m`;
}

/**
 * Assign one colour per category, without collisions.
 *
 * Hashing the name looked simpler and was wrong: 51 live categories into a
 * 32-colour palette collides by the birthday problem, and it did — one hue
 * ended up shared by Bread, Joints, Psychology and Technique, which destroys
 * the only reason to colour the label at all.
 *
 * The caller knows every category in the pool, so assignment is by index into
 * a sorted list instead. Sorted, so it stays stable as the pool is re-dealt
 * rather than shuffling colours on every rotation.
 */
function categoryColorMap(categories) {
  const sorted = [...new Set(categories.filter(Boolean))].sort();
  const map = {};
  sorted.forEach((name, i) => { map[name] = code256(CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]); });
  return map;
}

/** Fallback when the caller has no global view: stable, may collide. */
function categoryColorCode(name) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 131 + name.charCodeAt(i)) % 1000003;
  return code256(CATEGORY_PALETTE[h % CATEGORY_PALETTE.length]);
}

/**
 * @param {object} item  {category, text, url}
 * @param {string} style 'auto' | 'hyperlink' | 'url' | 'none'
 * @param {object} env
 * @param {string|null} hint  marker appended inside the link; null to omit
 * @param {string} color  key of COLORS applied to the linked text
 * @param {object} opts  { categoryColor: boolean, italicAction: boolean }
 */
function formatTip(item, style = 'auto', env = process.env, hint = DEFAULT_HINT, color = 'none', opts = {}) {
  const url = item.url;

  // The category sits outside the hyperlink, so it can carry its own colour
  // without touching the link.
  let category = '';
  if (item.category) {
    const explicit = opts.categoryColors && opts.categoryColors[item.category];
    const label = opts.categoryColor === false
      ? item.category
      : `${explicit || categoryColorCode(item.category)}${item.category}${FG_RESET}`;
    category = `${label}${SEP}`;
  }

  /**
   * Mechanism, then what to do about it.
   *
   * A card that explains starch retrogradation and stops has told the reader
   * something true and left them holding it. The action is what converts a
   * fact into a change in behaviour, and it's the difference between this
   * surface teaching someone and merely informing them. Marked with a
   * separate glyph so the eye can find it without reading the whole line.
   */
  // The action is italicised so the instruction is distinguishable from the
  // mechanism at a glance, without spending another colour on it.
  const action = item.action && opts.italicAction !== false
    ? sgrWrapSafe(item.action, ITALIC, ITALIC_OFF)
    : item.action;
  const text = item.action ? `${item.text} ▸ ${action}` : (item.text || '');

  if (!url || style === 'none') return `${category}${text}`;

  const useLink = style === 'hyperlink'
    || (style === 'auto' && terminalSupportsHyperlinks(env));

  // The category stays outside the link so the clickable region is the claim
  // itself, which is what the reader is deciding whether to follow.
  if (useLink) {
    const marked = hint ? `${text} ${hint}` : text;
    // Colour goes *inside* the hyperlink label, per word, so a wrap mid-claim
    // keeps its colour. The OSC 8 label is arbitrary text, so SGR codes inside
    // it are fine and the link stays intact.
    return `${category}${osc8(colorizeWrapSafe(marked, color), url)}`;
  }
  // In url mode only the url is tinted — colouring the whole claim would make
  // the line harder to read, not easier. A url has no spaces, so it cannot wrap
  // in a way that loses the colour.
  return `${category}${text} → ${colorize(url, color)}`;
}

/**
 * The spinner tip surface strips escapes, so a tip may not carry any.
 *
 * Claude Code 2.1.252 sanitizes every tip before it can be shown:
 *
 *   Bun.stripANSI(text)                     // SGR colour, gone
 *     .replace(/[\t\n\r\u2028\u2029]+/g, ' ')
 *     .replace(/[\p{Cc}\p{Cf}…]/gu, '')     // ESC itself, gone → OSC 8 gone
 *     .replace(/ {2,}/g, ' ').trim()
 *
 * then drops the tip entirely if it is empty or longer than 500 characters.
 *
 * Colour is the smaller loss. An OSC 8 hyperlink carries the URL *inside* the
 * escape, so a link-styled tip arrives as plain text with a dangling ↗ and
 * nothing to follow — the destination is destroyed along with the styling.
 * Tips therefore get built plain, with the URL visible as text; terminals
 * linkify a bare URL themselves, which is the affordance OSC 8 used to buy.
 *
 * The status line is not sanitized, so colour still lives there.
 */
const TIP_MAX_CHARS = 500;

/** Tip formatting that survives the sanitizer: no escapes, URL as text. */
function formatTipPlain(item, style = 'url') {
  const safe = style === 'none' ? 'none' : 'url';
  return formatTip(item, safe, process.env, null, 'none', {
    categoryColor: false,
    italicAction: false,
  });
}

/** False for a tip Claude Code would silently drop for length. */
function tipFitsSpinner(text) {
  return typeof text === 'string' && text.length > 0 && text.length <= TIP_MAX_CHARS;
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
  formatTip, formatTipPlain, tipFitsSpinner, TIP_MAX_CHARS, osc8, terminalSupportsHyperlinks, SEP, DEFAULT_HINT,
  formatDuration, formatHours, colorize, colorizeWrapSafe, sgrWrapSafe,
  categoryColorCode, categoryColorMap, COLORS, CATEGORY_PALETTE,
};
