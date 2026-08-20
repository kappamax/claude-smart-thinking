'use strict';

/**
 * Provider behaviour. Every test in this file is a regression: each one
 * corresponds to a bug that shipped and was found by reading output rather
 * than by any check.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-thinking-prov-'));
process.env.CLAUDE_CONFIG_DIR = TMP;

const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
// paths.STATE_DIR is CLAUDE_CONFIG_DIR/smart-thinking — clearing TMP directly
// silently cleared nothing, which let state leak between tests.
const STATE = path.join(TMP, 'smart-thinking');
const news = require('../providers/news');
const learn = require('../providers/learn');
const wellness = require('../providers/wellness');
const context = require('../providers/context');
const { interleave, collectAll } = require('../providers');

// ---------------------------------------------------------------- news

const RSS = `<rss><channel>
  <item><title>First &amp; foremost</title><link>https://ex.test/a</link><pubDate>Wed, 13 Aug 2026 10:00:00 GMT</pubDate></item>
  <item><title><![CDATA[Second <b>item</b>]]></title><guid isPermaLink="true">https://ex.test/b</guid><pubDate>Tue, 12 Aug 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>Atom one</title>
    <link rel="alternate" href="https://ex.test/atom1"/>
    <updated>2026-08-13T10:00:00Z</updated></entry>
</feed>`;

test('news: parses RSS items, decoding entities and CDATA', () => {
  const items = news._parseFeed(RSS);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].title, 'First & foremost');
  assert.strictEqual(items[1].title, 'Second item', 'CDATA and inner tags should be stripped');
});

test('news: extracts the article url from RSS <link> and from guid', () => {
  // Regression: headlines shipped with no url at all, which is the least
  // useful thing this surface can show.
  const items = news._parseFeed(RSS);
  assert.strictEqual(items[0].url, 'https://ex.test/a');
  assert.strictEqual(items[1].url, 'https://ex.test/b', 'permalink guid should be used as a fallback');
});

test('news: extracts the url from an Atom link href attribute', () => {
  const items = news._parseFeed(ATOM);
  assert.strictEqual(items[0].url, 'https://ex.test/atom1');
});

test('news: sample draws across the whole archive, not just the head', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ title: `t${i}`, ts: i }));
  const picked = news._sample(items, 5, Date.now());
  assert.strictEqual(picked.length, 5);
  assert.strictEqual(new Set(picked.map((p) => p.title)).size, 5, 'sample returned duplicates');
  assert.ok(picked.some((p) => items.indexOf(p) > 20), 'evergreen sampling never reached the archive');
});

test('news: sample is stable within a time slice and moves between them', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ title: `t${i}` }));
  const t = 1_700_000_000_000;
  const a = news._sample(items, 3, t).map((x) => x.title);
  const b = news._sample(items, 3, t + 1000).map((x) => x.title);
  const c = news._sample(items, 3, t + 20 * 60 * 1000).map((x) => x.title);
  assert.deepStrictEqual(a, b, 'a refresh and its rotation must agree');
  assert.notDeepStrictEqual(a, c, 'successive slices should land somewhere new');
});

test('news: a dead feed is isolated and reported, not swallowed', async () => {
  const res = await news.collect(
    { feeds: [{ label: 'Dead', url: 'https://this-host-does-not-exist.invalid/rss' }], maxPerFeed: 2 },
    { now: new Date() },
  );
  assert.deepStrictEqual(res.tips, [], 'a broken feed must not produce items');
  assert.ok(res.warnings.length > 0, 'a feed that stops contributing must be visible in the log');
});

// ---------------------------------------------------------------- learn

function deckCtx() {
  return { pluginRoot: ROOT, now: new Date(), context: { topics: new Set() } };
}

test('learn: a fresh deck does not serve one topic in a row', async () => {
  // Regression: unseen cards all scored Infinity, so the sort fell back to
  // deck order and the first refresh returned six consecutive Knuth cards.
  fs.rmSync(path.join(STATE, 'learn-state.json'), { force: true });
  const res = await learn.collect({ count: 8, contextShare: 0 }, deckCtx());
  const tags = res.tips.map((t) => t.category);
  assert.ok(new Set(tags).size > 1, `expected a mix of topics, got ${tags.join(', ')}`);
});

test('learn: context-matched cards get a share of slots, not all of them', async () => {
  fs.rmSync(path.join(STATE, 'learn-state.json'), { force: true });
  const ctx = { pluginRoot: ROOT, now: new Date(), context: { topics: new Set(['git', 'sql', 'http']) } };
  const res = await learn.collect({ count: 10, contextShare: 0.4 }, ctx);

  const matched = res.tips.filter((t) => ['Git', 'SQL', 'HTTP'].includes(t.category)).length;
  assert.ok(matched > 0, 'relevance never won a slot');
  assert.ok(matched <= 4, `context took ${matched}/10 slots; the cap should hold it to 4`);
});

test('learn: no card is served twice in one draw', async () => {
  fs.rmSync(path.join(STATE, 'learn-state.json'), { force: true });
  const res = await learn.collect({ count: 20, contextShare: 0.4 }, deckCtx());
  const texts = res.tips.map((t) => t.text);
  assert.strictEqual(new Set(texts).size, texts.length, 'duplicate cards in a single draw');
});

test('learn: the action travels with the card', async () => {
  fs.rmSync(path.join(STATE, 'learn-state.json'), { force: true });
  const res = await learn.collect({ count: 30, contextShare: 0 }, deckCtx());
  assert.ok(res.tips.some((t) => t.action), 'actions are being dropped before rendering');
});

// ---------------------------------------------------------------- wellness

const wCfg = {
  sleep: true, movement: true, sleepTipCount: 5,
  lateNightStartHour: 22, lateNightEndHour: 5, wakeTime: '07:00',
};

function at(hour) {
  const d = new Date(); d.setHours(hour, 30, 0, 0); return d;
}

test('wellness: sleep content appears late at night and not at midday', async () => {
  const night = await wellness.collect(wCfg, { now: at(1), pluginRoot: ROOT });
  const sleepAtNight = night.tips.filter((t) => t.category === 'Sleep').length;
  assert.ok(sleepAtNight > 0, 'no sleep content at 01:30');
  // Sleep should dominate at night without being the only thing — daytime
  // health claims run continuously so health isn't confined to 2am.
  assert.ok(sleepAtNight > night.tips.length / 2, 'late night should be sleep-weighted');

  fs.rmSync(path.join(STATE, 'wellness-state.json'), { force: true });
  const noon = await wellness.collect(wCfg, { now: at(13), pluginRoot: ROOT });
  assert.ok(!noon.tips.some((t) => t.category === 'Sleep'), 'sleep content leaked into the afternoon');
});

test('wellness: health content appears during the day, not only after a break', async () => {
  // Regression: the only non-sleep health tip was attached to the break
  // prompt, which needs 90 minutes of measured work — so in practice health
  // showed up late at night and almost never otherwise.
  fs.rmSync(path.join(STATE, 'wellness-state.json'), { force: true });
  const noon = await wellness.collect(wCfg, { now: at(13), pluginRoot: ROOT });
  assert.ok(noon.tips.length > 0, 'no health content at 13:30 with no break earned');
  assert.ok(noon.tips.every((t) => t.action), 'daytime health must still say what to do');
});

test('wellness: repeated sleep tips are distinct', async () => {
  // Regression: a strided pick shared a factor with the list length, so
  // asking for four tips returned the same two twice.
  const res = await wellness.collect(wCfg, { now: at(2), pluginRoot: ROOT });
  const texts = res.tips.map((t) => t.text);
  assert.strictEqual(new Set(texts).size, texts.length, `duplicates: ${texts.length - new Set(texts).size}`);
});

test('wellness: claims carry their evidence tier and a PubMed link', async () => {
  const res = await wellness.collect(wCfg, { now: at(1), pluginRoot: ROOT });
  for (const t of res.tips) {
    // The tier must NOT be rendered — evidence selects the claim, it isn't
    // part of the claim. It stays in the corpus for ranking and auditing.
    assert.ok(!/\((umbrella-review|meta-analysis|RCT|cohort|contested)\)$/.test(t.text),
      `evidence tier leaked into the text: ${t.text}`);
    assert.match(t.url, /ncbi\.nlm\.nih\.gov/, 'health claims must link primary literature');
    assert.ok(t.action, 'health claims must say what to do');
  }
});

test('wellness: the late-night status line avoids sleep-cycle arithmetic', async () => {
  // Regression: "sleeping now gets you 3 complete cycles" was false precision;
  // cycles run 70-120 minutes and lengthen through the night.
  const res = await wellness.collect(wCfg, { now: at(1), pluginRoot: ROOT });
  const line = res.status.map((s) => s.text).join(' ');
  assert.ok(!/complete (ones|cycles)/i.test(line), `cycle arithmetic is back: ${line}`);
});

// ---------------------------------------------------------------- context

test('context: a repo with no commits reports no commit age', () => {
  // Regression: `git log` exits non-zero on an empty repo, and Number(null)
  // is 0 — which dated the last commit to 1970.
  const git = { branch: 'main', dirty: 3, ahead: null, behind: null, lastCommitAgeHours: null };
  const out = context.introspect({}, { context: { git, shape: {}, projectName: 'x' } });
  assert.ok(!out.some((t) => /1970|20\d{3} day/.test(t.text)), 'epoch leaked into the output');
});

test('context: introspection fires on missing tests and stays quiet otherwise', () => {
  const withTests = context.introspect({}, {
    context: { projectName: 'x', shape: { fileCount: 40, hasTests: true, hasCi: true, hasReadme: true }, git: null },
  });
  assert.ok(!withTests.some((t) => /no test directory/.test(t.text)));

  const without = context.introspect({}, {
    context: { projectName: 'x', shape: { fileCount: 40, hasTests: false, hasReadme: true }, git: null },
  });
  assert.ok(without.some((t) => /no test directory/.test(t.text)));
});

// ---------------------------------------------------------------- registry

test('interleave round-robins sources so one feed cannot crowd out the deck', () => {
  const items = [
    ...Array.from({ length: 40 }, (_, i) => ({ source: 'news', text: `n${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ source: 'learn', text: `l${i}` })),
  ];
  const out = interleave(items, 10);
  const learned = out.filter((i) => i.source === 'learn').length;
  assert.ok(learned >= 4, `learn got only ${learned}/10 slots against a large news feed`);
});

test('a throwing provider degrades that source only', async () => {
  const cfg = { providers: { learn: { enabled: true, count: 3 }, news: { enabled: true, feeds: ['https://bad.invalid/x'] } } };
  const res = await collectAll(cfg, deckCtx());
  assert.ok(res.tips.length > 0, 'a failing provider took down the whole refresh');
  assert.ok(res.errors.length > 0, 'the failure was not reported');
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// --------------------------------------------------- pickDistinct contract

test('pickDistinct never repeats, at any list length or stride', () => {
  // The original bug was a strided index (seed + i*7) that collided whenever
  // the stride shared a factor with the list length. Testing it through
  // wellness.collect() could not reproduce it: the sleep corpus happens to
  // hold 9 claims, and 7 is coprime with 9. A test that only passes because
  // of the current corpus size is not testing anything, so the contract is
  // checked directly across the lengths that would expose a bad stride.
  for (const len of [2, 6, 7, 9, 12, 14, 21, 28]) {
    const list = Array.from({ length: len }, (_, i) => ({ id: i }));
    for (const n of [1, 2, 3, 4, 5, 7, len, len + 3]) {
      for (const seed of [0, 1, 7, 13, 100, 12345]) {
        const got = wellness._pickDistinct(list, seed, n);
        const uniq = new Set(got.map((g) => g.id));
        assert.strictEqual(uniq.size, got.length,
          `duplicates at len=${len} n=${n} seed=${seed}`);
        assert.strictEqual(got.length, Math.min(n, len),
          `wrong count at len=${len} n=${n}`);
      }
    }
  }
});

test('pickDistinct advances with the seed', () => {
  const list = Array.from({ length: 14 }, (_, i) => ({ id: i }));
  const a = wellness._pickDistinct(list, 0, 4).map((x) => x.id);
  const b = wellness._pickDistinct(list, 5, 4).map((x) => x.id);
  assert.notDeepStrictEqual(a, b, 'successive refreshes should show different claims');
});

// ------------------------------------------------ session activity tracking

const WSTATE = path.join(STATE, 'wellness-state.json');
const wellCfg = { sleep: false, movement: true, breakAfterHours: 0.01 };

async function tick(atMs, activity) {
  return wellness.collect(wellCfg, { now: new Date(atMs), pluginRoot: ROOT, activity });
}

test('an idle session accumulates no active time', async () => {
  // Regression: this reported "76.7h at the desk" for a window left open over
  // a weekend. The status line re-renders on a timer forever, so measuring
  // elapsed wall-clock between ticks never stopped counting.
  fs.rmSync(WSTATE, { force: true });
  const t0 = Date.UTC(2026, 7, 17, 12, 0, 0);
  const idle = { sessionId: 's1', cost: 1.5, apiMs: 1000 };

  for (let i = 0; i < 200; i += 1) await tick(t0 + i * 90_000, idle); // 5 hours of ticks
  const res = await tick(t0 + 200 * 90_000, idle);

  assert.deepStrictEqual(res.status, [], 'idle ticks must not trigger a break prompt');
  const state = JSON.parse(fs.readFileSync(WSTATE, 'utf8'));
  assert.strictEqual(state.activeMs, 0, `idle session accrued ${state.activeMs}ms`);
});

test('active time accrues only while cost is advancing', async () => {
  fs.rmSync(WSTATE, { force: true });
  const t0 = Date.UTC(2026, 7, 17, 12, 0, 0);
  let cost = 1;
  for (let i = 1; i <= 10; i += 1) {
    cost += 0.01; // Claude did work on each tick
    await tick(t0 + i * 60_000, { sessionId: 's1', cost, apiMs: i * 100 });
  }
  const state = JSON.parse(fs.readFileSync(WSTATE, 'utf8'));
  // Ten ticks a minute apart span nine intervals: the first tick only
  // establishes a baseline, since there is no earlier instant to measure from.
  assert.strictEqual(state.activeMs, 9 * 60_000, 'nine working minutes should count as nine');
});

test('a normal refresh interval is credited in full', async () => {
  // This provider runs only on a full refresh, 20 minutes apart by default.
  // A step cap below that interval would undercount every working stretch.
  fs.rmSync(WSTATE, { force: true });
  const t0 = Date.UTC(2026, 7, 17, 12, 0, 0);
  await tick(t0, { sessionId: 's1', cost: 1, apiMs: 10 });
  await tick(t0 + 20 * 60_000, { sessionId: 's1', cost: 2, apiMs: 20 });

  const state = JSON.parse(fs.readFileSync(WSTATE, 'utf8'));
  assert.strictEqual(state.activeMs, 20 * 60_000, 'a 20-minute working interval must count fully');
});

test('a single tick cannot credit more than the step cap', async () => {
  // A machine suspended mid-session must not donate the whole gap at once.
  fs.rmSync(WSTATE, { force: true });
  const t0 = Date.UTC(2026, 7, 17, 12, 0, 0);
  await tick(t0, { sessionId: 's1', cost: 1, apiMs: 10 });
  await tick(t0 + 28 * 60_000, { sessionId: 's1', cost: 2, apiMs: 20 }); // under idle reset

  const state = JSON.parse(fs.readFileSync(WSTATE, 'utf8'));
  assert.strictEqual(state.activeMs, 25 * 60_000, `single step added ${state.activeMs}ms`);
});

test('the step cap sits between the refresh interval and the idle reset', () => {
  const cfg = require('../lib/config').load();
  const refreshMin = cfg.contentMaxAgeMinutes;
  const idleMin = cfg.providers.wellness.idleResetMinutes;
  assert.ok(refreshMin < 25, `step cap 25m must exceed the ${refreshMin}m refresh interval`);
  assert.ok(25 < idleMin, `step cap 25m must fall below the ${idleMin}m idle reset`);
});

test('a gap beyond the idle window restarts the counter', async () => {
  fs.rmSync(WSTATE, { force: true });
  const t0 = Date.UTC(2026, 7, 17, 12, 0, 0);
  let cost = 1;
  for (let i = 1; i <= 5; i += 1) {
    cost += 0.01;
    await tick(t0 + i * 60_000, { sessionId: 's1', cost, apiMs: i });
  }
  await tick(t0 + 5 * 60_000 + 90 * 60_000, { sessionId: 's1', cost: cost + 1, apiMs: 99 });

  const state = JSON.parse(fs.readFileSync(WSTATE, 'utf8'));
  assert.ok(state.activeMs <= 5 * 60_000, 'a 90-minute break should have reset the stretch');
});

test('a new session resets the counters instead of stalling them', async () => {
  // Cost restarts at zero each session; without a session check that looks
  // like the counter running backwards, and nothing would ever accrue again.
  fs.rmSync(WSTATE, { force: true });
  const t0 = Date.UTC(2026, 7, 17, 12, 0, 0);
  await tick(t0, { sessionId: 'old', cost: 50, apiMs: 9999 });

  let cost = 0;
  for (let i = 1; i <= 3; i += 1) {
    cost += 0.01;
    await tick(t0 + i * 60_000, { sessionId: 'new', cost, apiMs: i });
  }
  const state = JSON.parse(fs.readFileSync(WSTATE, 'utf8'));
  assert.strictEqual(state.sessionId, 'new');
  assert.ok(state.activeMs > 0, 'a fresh session with lower cost stopped accruing entirely');
});

test('the break prompt rotates its advice and never repeats the 20-20-20 rule', async () => {
  // The old status line hardcoded "look 20ft away for 20s" — advice this
  // plugin's own corpus grades as contested after a null RCT.
  fs.rmSync(WSTATE, { force: true });
  const t0 = Date.UTC(2026, 7, 17, 12, 0, 0);
  let cost = 1;
  const seen = new Set();
  for (let i = 1; i <= 12; i += 1) {
    cost += 0.5;
    const res = await tick(t0 + i * 4 * 60_000, { sessionId: 's1', cost, apiMs: i * 10 });
    for (const s of res.status) {
      assert.ok(!/20ft|20-20-20/.test(s.text), `contested advice resurfaced: ${s.text}`);
      assert.ok(!/\((umbrella-review|meta-analysis|RCT|cohort|contested)\)$/.test(s.text),
        `evidence tier leaked into the status line: ${s.text}`);
      seen.add(s.text.replace(/^[\d.]+h active · /, ''));
    }
  }
  assert.ok(seen.size > 1, `advice never rotated (${seen.size} distinct)`);
});

// ------------------------------------------------------------- literature

test('literature: publication type maps to an evidence tier', () => {
  const t = require('../providers/literature')._tierOf;
  assert.strictEqual(t(['Meta-Analysis', 'Journal Article']), 'meta-analysis');
  assert.strictEqual(t(['Systematic Review']), 'systematic review');
  assert.strictEqual(t(['Randomized Controlled Trial']), 'RCT');
  // Anything that got through the review-type filter is at least peer reviewed.
  assert.strictEqual(t(['Journal Article']), 'peer-reviewed');
  assert.strictEqual(t([]), 'peer-reviewed');
});

test('literature: no topics configured means no output, not an error', async () => {
  const lit = require('../providers/literature');
  const r = await lit.collect({ topics: [] }, { now: new Date() });
  assert.deepStrictEqual(r.tips, []);
});
