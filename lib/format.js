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
 * @param {object} item  {category, text, url}
 * @param {string} style 'auto' | 'hyperlink' | 'url' | 'none'
 */
function formatTip(item, style = 'auto', env = process.env) {
  const category = item.category ? `${item.category}${SEP}` : '';
  const text = item.text || '';
  const url = item.url;

  if (!url || style === 'none') return `${category}${text}`;

  const useLink = style === 'hyperlink'
    || (style === 'auto' && terminalSupportsHyperlinks(env));

  // The category stays outside the link so the clickable region is the claim
  // itself, which is what the reader is deciding whether to follow.
  if (useLink) return `${category}${osc8(text, url)}`;
  return `${category}${text} → ${url}`;
}

module.exports = { formatTip, osc8, terminalSupportsHyperlinks, SEP };
