#!/usr/bin/env node
'use strict';

/**
 * Report — and optionally remove — timely cards that have aged out.
 *
 * A `lifespan: "timely"` card fades over its lifetime and is excluded from
 * selection once past it, so a stale card never reaches the reader. But it stays
 * in the file, because deleting content on a timer is the kind of thing that
 * should be visible. This is where the reset happens, deliberately.
 *
 *   node bin/prune.js                  # report only
 *   node bin/prune.js --apply          # remove retired cards from the user deck
 *   node bin/prune.js --ttl 14         # override the lifetime for this run
 */

const path = require('path');
const paths = require('../lib/paths');
const { readJson, writeJsonAtomic } = require('../lib/jsonio');
const { DEFAULT_TTL_DAYS } = require('../providers/learn');
const config = require('../lib/config');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? (process.argv[i + 1] || true) : null;
}

function ageDays(card, now) {
  const created = Date.parse(card.createdAt || '');
  return Number.isNaN(created) ? null : (now - created) / 86400000;
}

function main() {
  const cfg = config.load();
  const ttl = Number(arg('--ttl')) || (cfg.providers.learn && cfg.providers.learn.timelyTtlDays) || DEFAULT_TTL_DAYS;
  const apply = process.argv.includes('--apply');
  const now = Date.now();

  // Only the user's deck is pruned. The shipped deck is version-controlled
  // content, not a place where things accumulate.
  const deck = readJson(paths.deckFile, null);
  if (!deck || !Array.isArray(deck.cards)) {
    console.log(`no user deck at ${paths.deckFile} — nothing to prune`);
    return;
  }

  const timely = deck.cards.filter((c) => c.lifespan === 'timely');
  const retired = timely.filter((c) => {
    const age = ageDays(c, now);
    return age === null || age >= (c.ttlDays || ttl);
  });
  const fading = timely
    .filter((c) => !retired.includes(c))
    .map((c) => ({ c, age: ageDays(c, now) }))
    .sort((a, b) => b.age - a.age);

  console.log(`${deck.cards.length} cards · ${timely.length} timely · lifetime ${ttl} days\n`);

  if (fading.length) {
    console.log('still in rotation:');
    for (const { c, age } of fading) {
      const left = Math.max(0, (c.ttlDays || ttl) - age);
      console.log(`  ${c.id.padEnd(28)} ${Math.floor(age)}d old · ${Math.ceil(left)}d left`);
    }
    console.log('');
  }

  if (retired.length === 0) {
    console.log('nothing retired.');
    return;
  }

  console.log(`retired — no longer shown, ${apply ? 'removing' : 'still in the file'}:`);
  for (const c of retired) {
    const age = ageDays(c, now);
    console.log(`  ${c.id.padEnd(28)} ${age === null ? 'no usable createdAt' : `${Math.floor(age)}d old`}`);
  }

  if (!apply) {
    console.log('\nRe-run with --apply to remove them. Nothing was changed.');
    return;
  }

  const keep = deck.cards.filter((c) => !retired.includes(c));
  writeJsonAtomic(paths.deckFile, { ...deck, cards: keep });
  console.log(`\nremoved ${retired.length}; ${keep.length} remain in ${paths.deckFile}`);
}

main();
