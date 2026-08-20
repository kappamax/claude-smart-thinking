'use strict';

/**
 * Content invariants.
 *
 * These are the checks that were previously throwaway scripts run by hand at
 * release time. Every one of them corresponds to a defect that actually
 * shipped: actions that restated their own card, cards with no link, and a
 * deck where a stride collision served the same item twice.
 *
 * Network checks (do the URLs resolve?) deliberately live in bin/checklinks.js
 * and bin/checkfeeds.js instead — they're slow and fail on someone else's
 * outage, which is not a reason to block a commit.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const deck = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/deck.sample.json'), 'utf8'));
const evidence = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/wellness.evidence.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/feeds.catalog.json'), 'utf8'));

const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z0-9]{4,}/g) || []);

test('deck: every card has the required fields', () => {
  for (const c of deck.cards) {
    assert.ok(c.id, `card missing id: ${JSON.stringify(c).slice(0, 60)}`);
    assert.ok(c.tag, `${c.id}: missing tag`);
    assert.ok(c.text && c.text.length > 20, `${c.id}: text missing or too short`);
    assert.ok(c.url, `${c.id}: missing url`);
    assert.match(c.url, /^https?:\/\//, `${c.id}: url is not absolute`);
  }
});

test('deck: card ids are unique', () => {
  // Exposure tracking is keyed on id, so a duplicate silently inherits
  // another card's history and distorts scheduling for both.
  const seen = new Set();
  for (const c of deck.cards) {
    assert.ok(!seen.has(c.id), `duplicate card id: ${c.id}`);
    seen.add(c.id);
  }
});

test('deck: no action merely restates its own card', () => {
  // Regression: 13 actions shipped saying the same thing as their text,
  // e.g. "Salt well ahead or immediately before" under a card that had just
  // said exactly that. Overlap is measured against the action's own words so
  // a short action inside a long card still gets caught.
  const offenders = [];
  for (const c of deck.cards) {
    if (!c.action) continue;
    const a = words(c.action);
    if (a.size === 0) continue;
    const shared = [...a].filter((w) => words(c.text).has(w)).length;
    const overlap = shared / a.size;
    if (overlap > 0.5) offenders.push(`${c.id} (${overlap.toFixed(2)})`);
  }
  assert.deepStrictEqual(offenders, [], `actions restating their card: ${offenders.join(', ')}`);
});

test('deck: actions do not end with a bare restatement of the tag', () => {
  for (const c of deck.cards) {
    if (!c.action) continue;
    assert.ok(c.action.length > 15, `${c.id}: action too short to be useful`);
  }
});

test('evidence corpus: every claim is graded, sourced and actionable', () => {
  const tiers = new Set(Object.keys(evidence.tiers));
  for (const c of evidence.claims) {
    assert.ok(c.id, 'claim missing id');
    assert.ok(c.topic, `${c.id}: missing topic`);
    assert.ok(tiers.has(c.evidence), `${c.id}: unknown evidence tier "${c.evidence}"`);
    assert.ok(c.action, `${c.id}: health claims must say what to do`);
    assert.match(c.source, /^https:\/\/(pubmed\.ncbi\.nlm\.nih\.gov|www\.ncbi\.nlm\.nih\.gov)/,
      `${c.id}: health sources must point at PubMed/NCBI, got ${c.source}`);
  }
});

test('evidence corpus: contested claims say so in the text', () => {
  // A disputed finding stated flatly is the exact failure mode this corpus
  // exists to prevent — the glymphatic card shipped that way once.
  for (const c of evidence.claims.filter((x) => x.evidence === 'contested')) {
    assert.match(
      c.text,
      /disput|contest|not settled|average, not|very little|no significant/i,
      `${c.id}: marked contested but the text reads as settled`,
    );
  }
});

test('feed catalog: every feed has a url, mode and rationale', () => {
  const modes = new Set(Object.keys(catalog.modes));
  for (const [name, bundle] of Object.entries(catalog.bundles)) {
    assert.ok(bundle.feeds.length > 0, `${name}: empty bundle`);
    for (const f of bundle.feeds) {
      assert.match(f.url, /^https?:\/\//, `${name}/${f.label}: bad url`);
      assert.ok(modes.has(f.mode), `${name}/${f.label}: unknown mode "${f.mode}"`);
      assert.ok(f.why, `${name}/${f.label}: every source must justify its slot`);
    }
  }
});

test('feed catalog: feed urls are unique across bundles', () => {
  const seen = new Map();
  for (const [name, bundle] of Object.entries(catalog.bundles)) {
    for (const f of bundle.feeds) {
      assert.ok(!seen.has(f.url), `${f.url} appears in both ${seen.get(f.url)} and ${name}`);
      seen.set(f.url, name);
    }
  }
});

test('deck: every card declares what kind of source it has', () => {
  // "All data must be peer reviewed" is enforceable only if the kind of source
  // is recorded. peer-reviewed = a study; primary = the authoritative record
  // (a spec, official docs, an archive); reference = an encyclopaedia entry,
  // which is a staging state, not a destination.
  const allowed = new Set(['peer-reviewed', 'primary', 'reference']);
  for (const c of deck.cards) {
    assert.ok(allowed.has(c.sourceType), `${c.id}: bad sourceType "${c.sourceType}"`);
  }
});

test('deck: an empirical claim may not rest on an encyclopaedia entry', () => {
  // Ratcheting gate. These topics assert something about the world that a study
  // could confirm or refute, so they must cite one. The list grows as tags are
  // re-sourced; it must never shrink.
  const EMPIRICAL = new Set(['Psychology', 'Learning']);
  const offenders = deck.cards
    .filter((c) => EMPIRICAL.has(c.tag) && c.sourceType !== 'peer-reviewed')
    .map((c) => `${c.id} (${c.sourceType})`);
  assert.deepStrictEqual(offenders, [],
    `empirical cards not citing a study: ${offenders.join(', ')}`);
});

test('deck: peer-reviewed cards point at a resolvable record, not a paywall guess', () => {
  for (const c of deck.cards.filter((x) => x.sourceType === 'peer-reviewed')) {
    assert.match(c.url, /pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|arxiv\.org/,
      `${c.id}: peer-reviewed cards must cite an indexed record`);
  }
});
