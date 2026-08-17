'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { formatTip, osc8, terminalSupportsHyperlinks, SEP } = require('../lib/format');

const ITEM = {
  category: 'Bread',
  text: 'Stale bread is starch retrogradation, not drying.',
  action: 'Freeze it; never refrigerate.',
  url: 'https://example.org/staling',
};

const ITERM = { TERM_PROGRAM: 'iTerm.app' };
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
  const out = formatTip(ITEM, 'none');
  assert.ok(out.includes('▸ Freeze it; never refrigerate.'), 'action missing');
  assert.ok(out.indexOf(ITEM.text) < out.indexOf('▸'), 'mechanism must precede the action');
});

test('a card with no action renders without a dangling marker', () => {
  const out = formatTip({ category: 'Knuth', text: 'Pays $2.56 per error.' }, 'none');
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
  assert.strictEqual(formatDuration(23.99 * 3_600_000), '23h 59m', 'no need to force a day boundary');

  for (let ms = 0; ms <= 4 * 24 * 3_600_000; ms += 37_000) {
    const out = formatDuration(ms);
    assert.ok(!/\b60m\b/.test(out), `emitted 60m at ${ms}ms: ${out}`);
    assert.ok(!/\b24h\b/.test(out), `emitted 24h at ${ms}ms: ${out}`);
    assert.ok(!/NaN|undefined|-/.test(out), `malformed output at ${ms}ms: ${out}`);
  }
});
