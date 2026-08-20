'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { formatTip, osc8, terminalSupportsHyperlinks, SEP } = require('../lib/format');

const ITEM = {
  category: 'Bread',
  text: 'Stale bread is starch retrogradation, not drying.',
  action: 'Freeze it; never refrigerate.',
  url: 'https://example.org/staling',
};

const ITERM = { TERM_PROGRAM: 'iTerm.app' };
// Several tests below assert on exact structure and predate category colour and
// italics, which are on by default. NO_DECOR turns the decoration off so each
// test still checks the one thing it was written to check.
const NO_DECOR = { categoryColor: false, italicAction: false };
const PLAIN = { TERM_PROGRAM: 'Apple_Terminal' };

test('hyperlink mode hides the url and keeps the text clickable', () => {
  const out = formatTip(ITEM, 'auto', ITERM);
  assert.ok(!out.includes('https://example.org/staling '), 'url should not be visible as text');
  assert.ok(out.includes('\x1b]8;;https://example.org/staling\x07'), 'missing OSC 8 opener');
  assert.ok(out.endsWith('\x1b]8;;\x07'), 'missing OSC 8 terminator');
});

test('hyperlink mode includes a visible affordance', () => {
  // Regression: hiding the url removed the only cue that the text led
  // anywhere, so it read as a dead end.
  const out = formatTip(ITEM, 'auto', ITERM);
  assert.ok(out.includes('↗'), 'hyperlinked text needs a visible marker');
});

test('the affordance sits inside the link so clicking it works', () => {
  const out = formatTip(ITEM, 'auto', ITERM);
  const close = out.indexOf('\x1b]8;;\x07');
  assert.ok(out.indexOf('↗') < close, 'marker must fall inside the hyperlink');
});

test('terminals without hyperlink support fall back to a visible url', () => {
  const out = formatTip(ITEM, 'auto', PLAIN);
  assert.ok(out.includes('→ https://example.org/staling'), 'expected plain url fallback');
  assert.ok(!out.includes('\x1b]8'), 'must not emit escapes a terminal cannot render');
});

test('action is rendered after the mechanism, with a marker', () => {
  const out = formatTip(ITEM, 'none', {}, undefined, 'none', NO_DECOR);
  assert.ok(out.includes('▸ Freeze it; never refrigerate.'), 'action missing');
  assert.ok(out.indexOf(ITEM.text) < out.indexOf('▸'), 'mechanism must precede the action');
});

test('a card with no action renders without a dangling marker', () => {
  const out = formatTip({ category: 'Knuth', text: 'Pays $2.56 per error.' }, 'none', {}, undefined, 'none', NO_DECOR);
  assert.ok(!out.includes('▸'), 'no action means no marker');
  assert.strictEqual(out, `Knuth${SEP}Pays $2.56 per error.`);
});

test('a card with no url never emits a link', () => {
  const out = formatTip({ category: 'Project', text: '33 files, no tests.' }, 'auto', ITERM);
  assert.ok(!out.includes('\x1b]8'), 'no url means no hyperlink');
  assert.ok(!out.includes('↗'), 'no url means no affordance');
});

test('style overrides beat terminal detection', () => {
  assert.ok(formatTip(ITEM, 'hyperlink', PLAIN).includes('\x1b]8'), 'forced hyperlink ignored');
  assert.ok(!formatTip(ITEM, 'url', ITERM).includes('\x1b]8'), 'forced url mode ignored');
  assert.ok(!formatTip(ITEM, 'none', ITERM).includes('example.org'), 'none should drop the link entirely');
});

test('terminal detection covers TERM as well as TERM_PROGRAM', () => {
  assert.ok(terminalSupportsHyperlinks({ TERM_PROGRAM: 'WezTerm' }));
  assert.ok(terminalSupportsHyperlinks({ TERM: 'xterm-kitty' }));
  assert.ok(!terminalSupportsHyperlinks({ TERM_PROGRAM: 'Apple_Terminal' }));
  assert.ok(!terminalSupportsHyperlinks({}));
});

test('FORCE_HYPERLINK overrides detection in both directions', () => {
  assert.ok(terminalSupportsHyperlinks({ FORCE_HYPERLINK: '1' }));
  assert.ok(!terminalSupportsHyperlinks({ FORCE_HYPERLINK: '0', TERM_PROGRAM: 'iTerm.app' }));
});

test('osc8 produces a well-formed sequence', () => {
  assert.strictEqual(osc8('label', 'https://x.test'), '\x1b]8;;https://x.test\x07label\x1b]8;;\x07');
});

// ------------------------------------------------------ duration formatting

const { formatDuration, formatHours } = require('../lib/format');

test('durations read the way a person says them', () => {
  // "1.8h active" is a machine reporting a float; nobody says that out loud.
  const m = 60_000;
  const h = 60 * m;
  assert.strictEqual(formatDuration(10_000), 'under a minute');
  assert.strictEqual(formatDuration(30_000), '1m', '30s rounds up rather than vanishing');
  assert.strictEqual(formatDuration(1 * m), '1m');
  assert.strictEqual(formatDuration(45 * m), '45m');
  assert.strictEqual(formatDuration(1 * h), '1h');
  assert.strictEqual(formatDuration(105 * m), '1h 45m');
  assert.strictEqual(formatDuration(2 * h), '2h');
  assert.strictEqual(formatDuration(5.5 * h), '5h 30m');
  assert.strictEqual(formatDuration(26 * h), '1d 2h');
  assert.strictEqual(formatDuration(72 * h), '3d');
});

test('precision drops as the duration grows, the way speech does', () => {
  const m = 60_000;
  const h = 60 * m;
  // Nobody says "1 hour 47 minutes"; they round without thinking about it.
  assert.strictEqual(formatDuration(1 * h + 47 * m), '1h 45m');
  assert.strictEqual(formatDuration(1 * h + 58 * m), '2h');
  // And nobody quotes minutes for something a day old.
  assert.strictEqual(formatDuration(23 * h + 59 * m), '1d');
  assert.strictEqual(formatDuration(47 * h + 50 * m), '2d');
  assert.strictEqual(formatDuration(25 * h), '1d 1h');
  // Below an hour the minute still matters, so it is kept.
  assert.strictEqual(formatDuration(47 * m), '47m');
});

test('no duration past a day ever reports minutes', () => {
  const DAY = 24 * 3_600_000;
  for (let ms = DAY; ms <= 10 * DAY; ms += 917_000) {
    const out = formatDuration(ms);
    assert.ok(!/m$/.test(out), `minutes leaked into a multi-day duration: ${out}`);
    assert.match(out, /^\d+d( \d+h)?$/, `unexpected shape past a day: ${out}`);
  }
});

test('formatHours matches formatDuration', () => {
  assert.strictEqual(formatHours(1.75), '1h 45m');
  assert.strictEqual(formatHours(0.5), '30m');
  assert.strictEqual(formatHours(24), '1d');
});

test('no decimal hours survive anywhere in the rendered output', () => {
  // Guards against a caller reintroducing `.toFixed(1)}h`.
  assert.ok(!/\d\.\d+h/.test(formatHours(1.8)), 'decimal hours leaked through');
  assert.ok(!/\d\.\d+h/.test(formatDuration(6_540_000)), 'decimal hours leaked through');
});

test('rounding never emits an impossible unit', () => {
  // 59.7 minutes must become "1h", not "60m". Sweeping the whole range is
  // what catches an off-by-one at a boundary; two spot checks would not.
  assert.strictEqual(formatDuration(59.7 * 60_000), '1h', '59.7m should roll up to an hour');
  assert.strictEqual(formatDuration(23.99 * 3_600_000), '1d', '23h 59m is "a day" to a person');

  for (let ms = 0; ms <= 4 * 24 * 3_600_000; ms += 37_000) {
    const out = formatDuration(ms);
    assert.ok(!/\b60m\b/.test(out), `emitted 60m at ${ms}ms: ${out}`);
    assert.ok(!/\b24h\b/.test(out), `emitted 24h at ${ms}ms: ${out}`);
    assert.ok(!/NaN|undefined|-/.test(out), `malformed output at ${ms}ms: ${out}`);
  }
});

// ------------------------------------------------------------- link colour

test('a coloured hyperlink tints the label and leaves the escape intact', () => {
  const out = formatTip(ITEM, 'hyperlink', {}, undefined, 'blue', NO_DECOR);
  // Colour sits *inside* the OSC 8 label, not around it, so that it can be
  // re-applied per word and survive the renderer wrapping the line.
  assert.ok(out.startsWith('Bread · \x1b]8;;'), 'the link should open first');
  assert.ok(out.includes('\x1b]8;;https://example.org/staling\x07\x1b[34m'), 'colour should start inside the label');
  assert.ok(out.endsWith('\x1b]8;;\x07'), 'the link must close last');
  // 39 resets only the foreground; 0 would also clear any dim attribute the
  // surrounding line is using.
  assert.ok(!out.includes('\x1b[0m'), 'must not use a full reset');
});

test('url mode tints only the url, not the whole claim', () => {
  const out = formatTip(ITEM, 'url', {}, undefined, 'blue');
  const idx = out.indexOf('\x1b[34m');
  assert.ok(idx > out.indexOf(ITEM.text), 'colour started before the url');
  assert.ok(out.includes('\x1b[34mhttps://example.org/staling\x1b[39m'));
});

test('colour none emits no escape at all', () => {
  const out = formatTip(ITEM, 'hyperlink', {}, undefined, 'none', NO_DECOR);
  assert.ok(!out.includes('\x1b[34m'));
  assert.ok(!out.includes('\x1b[39m'));
});

test('an unknown colour name degrades to no colour rather than garbage', () => {
  const out = formatTip(ITEM, 'hyperlink', {}, undefined, 'chartreuse', NO_DECOR);
  assert.ok(!/\x1b\[\d*m/.test(out), 'an unrecognised colour must not emit a partial escape');
});

test('a card with no url is never coloured', () => {
  const out = formatTip({ category: 'Project', text: '33 files, no tests.' }, 'hyperlink', {}, undefined, 'blue', NO_DECOR);
  assert.ok(!out.includes('\x1b['), 'nothing to link means nothing to tint');
});

test('colour is re-applied per word so a wrapped tip stays coloured', () => {
  // A single leading SGR is terminal state and survives a wrap — unless the
  // renderer splits the string and emits each line separately, which drops the
  // colour on every continuation line.
  const out = formatTip(ITEM, 'hyperlink', {}, undefined, 'blue');
  const opens = (out.match(/\x1b\[34m/g) || []).length;
  assert.ok(opens > 5, `expected the colour re-applied per word, saw ${opens} occurrences`);

  // Every word of the visible label must carry it, so no wrap point is naked.
  const label = ITEM.text.split(' ').filter(Boolean);
  for (const w of label) {
    assert.ok(out.includes(`\x1b[34m${w}`), `word not coloured: ${w}`);
  }
});

test('the hyperlink still works with colour codes inside the label', () => {
  const out = formatTip(ITEM, 'hyperlink', {}, undefined, 'blue', NO_DECOR);
  assert.ok(out.includes(`\x1b]8;;${ITEM.url}\x07`), 'OSC 8 opener damaged');
  assert.ok(out.endsWith('\x1b]8;;\x07'), 'OSC 8 must still close last');
  // Exactly one reset, at the end of the label rather than sprinkled through.
  assert.strictEqual((out.match(/\x1b\[39m/g) || []).length, 1);
});

test('category colours do not collide within a pool', () => {
  // Hashing the name collided badly — 51 categories into a 32-colour palette
  // put Bread, Joints, Psychology and Technique on the same hue, which defeats
  // the entire point of colouring the label. Index assignment is collision-free
  // up to the palette size, which comfortably exceeds any real pool.
  const { categoryColorMap, CATEGORY_PALETTE } = require('../lib/format');
  const pool = ['Sleep', 'Bread', 'Psychology', 'Technique', 'Knuth', 'Exercise',
    'Nutrition', 'Travel', 'Statistics', 'Cooking', 'Biology', 'Design'];
  const map = categoryColorMap(pool);
  assert.strictEqual(new Set(Object.values(map)).size, pool.length, 'colours collided');
  assert.ok(pool.length < CATEGORY_PALETTE.length, 'palette must exceed a realistic pool');
});

test('category colour assignment is stable across re-deals', () => {
  const { categoryColorMap } = require('../lib/format');
  const a = categoryColorMap(['Sleep', 'Bread', 'Knuth']);
  // Same set, different order — a rotation must not reshuffle the colours.
  const b = categoryColorMap(['Knuth', 'Sleep', 'Bread', 'Sleep']);
  assert.deepStrictEqual(a, b);
});

test('the action is italicised, wrap-safely, and closes before the hint', () => {
  const out = formatTip(ITEM, 'hyperlink', {}, undefined, 'blue');
  assert.ok(out.includes('\x1b[3m'), 'action not italicised');
  assert.ok(out.includes('\x1b[23m'), 'italic never closed');
  // Italic must not bleed onto the trailing affordance.
  assert.ok(out.lastIndexOf('\x1b[23m') < out.lastIndexOf('↗'), 'italic leaked past the action');
  // Re-applied per word so a wrap inside the action keeps it.
  assert.ok((out.match(/\x1b\[3m/g) || []).length > 1, 'italic not wrap-safe');
});

// ------------------------------------------------------- status line styling

test('status line styling is readable and wrap-safe', () => {
  // Regression: the status line used ANSI faint unconditionally, which many
  // terminals render as near-black — unreadable on a dark background.
  const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'statusline.js'), 'utf8');
  assert.ok(!/lines\.push\(`\$\{DIM\}/.test(src), 'faint is no longer applied unconditionally');
  assert.match(src, /DEFAULT_STATUS_STYLE = 'grey'/, 'default should be a legible mid-tone');
  // Re-applied per word, for the same reason tips are.
  assert.match(src, /text\.split\(' '\)\.map/, 'status styling must survive a wrap');
});
