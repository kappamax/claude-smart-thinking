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

test('feed catalog is documented as a reading list, not a tip source', () => {
  // The provider that consumed it is gone. The file survives because the
  // curation was real work and the sources were verified — but nothing should
  // read it back into tips, so the note has to say so.
  assert.match(catalog.note, /NOT wired into tips/i,
    'the catalog must state that it no longer feeds the spinner');
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

test('deck: the source vocabulary is documented in the data', () => {
  // The definitions live alongside the cards so a future reader can see why a
  // card citing a textbook is "primary" rather than assuming it is a mistake.
  assert.ok(deck.sourceTypes, 'deck must document what each sourceType means');
  for (const k of ['peer-reviewed', 'primary', 'reference']) {
    assert.ok(deck.sourceTypes[k], `sourceType "${k}" is undocumented`);
  }
});

test('deck: no gated tag may rest on an encyclopaedia entry', () => {
  // A weaker ratchet than the peer-reviewed gate, for topics that are settled
  // textbook science: nobody is still publishing on whether the Maillard
  // reaction exists, so "primary" is the honest ceiling there. What is not
  // acceptable is an encyclopaedia entry.
  const NO_REFERENCE = new Set(['Cooking', 'Bread', 'Coffee', 'Chemistry']);
  const offenders = deck.cards
    .filter((c) => NO_REFERENCE.has(c.tag) && c.sourceType === 'reference')
    .map((c) => c.id);
  assert.deepStrictEqual(offenders, [], `still on an encyclopaedia: ${offenders.join(', ')}`);
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
  // Mathematics is deliberately absent: a theorem's truth does not rest on
  // evidence, so holding a proof to a peer-reviewed-study standard is a
  // category error rather than a higher bar.
  const EMPIRICAL = new Set(['Psychology', 'Learning', 'Statistics']);
  const offenders = deck.cards
    .filter((c) => EMPIRICAL.has(c.tag) && c.sourceType !== 'peer-reviewed')
    .map((c) => `${c.id} (${c.sourceType})`);
  assert.deepStrictEqual(offenders, [],
    `empirical cards not citing a study: ${offenders.join(', ')}`);
});

test('deck: a peer-reviewed card cites the paper, not an encyclopaedia', () => {
  // An allowlist of hosts was too narrow. Computer science publishes through
  // ACM and IEEE, both of which return 403 to any automated client, so the
  // accessible copy of a paper is often an author's or institution's PDF —
  // legitimately the paper, just not on a host anyone could enumerate. What
  // matters is that it is not a summary of the paper.
  const NOT_A_PAPER = /wikipedia\.org|wikimedia\.org|medium\.com|\bblog\b/i;
  for (const c of deck.cards.filter((x) => x.sourceType === 'peer-reviewed')) {
    assert.ok(!NOT_A_PAPER.test(c.url), `${c.id}: cites a summary, not the paper — ${c.url}`);
    assert.match(c.url, /^https?:\/\//, `${c.id}: bad url`);
  }
});

test('deck: Technique is deliberately not gated, and the reason is recorded', () => {
  // Most Technique cards describe a design practice rather than an empirical
  // finding, so a study is the wrong standard. Of those that do have a
  // canonical paper, many are behind ACM or IEEE paywalls that return 403 —
  // and a link to a 403 serves the reader worse than an encyclopaedia entry
  // does. This test exists so the gap is a recorded decision, not an oversight.
  const tech = deck.cards.filter((c) => c.tag === 'Technique');
  assert.ok(tech.length > 20, 'expected the Technique corpus to still be substantial');
  const sourced = tech.filter((c) => c.sourceType !== 'reference').length;
  assert.ok(sourced >= 15, `Technique regressed: only ${sourced}/${tech.length} above reference`);
});

test('health content lives in the graded corpus, never in the deck', () => {
  // The deck carried six Health cards that duplicated corpus claims on
  // Wikipedia links with no evidence grading — including the "nap 20 or 90
  // minutes" cycle arithmetic that the corpus explicitly marks contested. The
  // plugin could therefore serve a debunked claim and its correction in the
  // same rotation. One home per domain, and for health that home is graded.
  const CORPUS_OWNS = new Set(['Health', 'Sleep', 'Nutrition', 'Exercise',
    'Meditation', 'Breathing', 'Mental health', 'Medicine', 'Alcohol']);
  const offenders = deck.cards
    .filter((c) => CORPUS_OWNS.has(c.tag))
    .map((c) => `${c.id} (${c.tag})`);
  assert.deepStrictEqual(offenders, [],
    `health claims must move to wellness.evidence.json: ${offenders.join(', ')}`);
});
