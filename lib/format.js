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
 * @param {object} item  {category, text, url}
 * @param {string} style 'auto' | 'hyperlink' | 'url' | 'none'
 * @param {object} env
 * @param {string|null} hint  marker appended inside the link; null to omit
 */
function formatTip(item, style = 'auto', env = process.env, hint = DEFAULT_HINT) {
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
    return `${category}${osc8(marked, url)}`;
  }
  return `${category}${text} → ${url}`;
}

/**
 * Durations the way a person says them.
 *
 * "1.8h active" is a machine reporting a float. Nobody says that out loud —
 * they say "1h 45m". Since every duration in this plugin is read at a glance
 * mid-task, they all go through here rather than each caller inventing its
 * own decimal.
 */
function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return 'under a minute';
  if (totalMin < 60) return `${totalMin}m`;

  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 24) return mins ? `${hours}h ${mins}m` : `${hours}h`;

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

/** Convenience for the many callers that already hold hours. */
function formatHours(hours) {
  return formatDuration(hours * 3600000);
}

module.exports = {
  formatTip, osc8, terminalSupportsHyperlinks, SEP, DEFAULT_HINT,
  formatDuration, formatHours,
};
