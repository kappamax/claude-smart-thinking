'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('../lib/paths');
const { readJson, writeJsonAtomic } = require('../lib/jsonio');

/**
 * Spaced *exposure*, deliberately not spaced repetition.
 *
 * Real SRS needs a grade signal ("did you recall it?") after each review. The
 * spinner is a read-only surface: the user can't answer a card, so there is no
 * signal to schedule against. Claiming SM-2 here would be theatre.
 *
 * What we can do honestly is decay frequency by exposure count — a card seen
 * twice competes less hard for a slot than a card seen zero times, with the
 * interval doubling each time and capping out. New material dominates early,
 * older material resurfaces occasionally.
 *
 * Note we track *supplied* rather than *displayed*, since Claude Code chooses
 * which of the supplied tips to render. Over many refreshes the two converge:
 * the picker sorts by least-recently-shown across a stable set of slot ids.
 */

const BASE_INTERVAL_MIN = 45;
const MAX_INTERVAL_MIN = 60 * 24 * 7;

/**
 * Merge the shipped deck with the user's, rather than letting theirs replace it.
 *
 * The user's deck.json used to win outright, which quietly froze the deck at
 * whatever the shipped version was on the day they copied it. It bit twice: a
 * stale 131-card copy served the reference-manual cards for several releases
 * after they were cut, and then a 185-card copy hid the entire travel batch —
 * 20 cards in the shipped deck, 9 reaching the reader, with no error anywhere.
 *
 * Union by id, user entries winning on conflict. Shipped additions arrive
 * automatically; edits and additions of their own survive an update. A card the
 * user deletes will come back, which is the deliberate trade: silently losing
 * new content is worse than an unwanted card reappearing, and `hidden: true`
 * is the way to suppress one for good.
 */
function loadDeck(pluginRoot) {
  const sample = path.join(pluginRoot, 'data', 'deck.sample.json');
  const shipped = fs.existsSync(sample) ? readJson(sample, { cards: [] }) : { cards: [] };
  const user = readJson(paths.deckFile, null);

  const byId = new Map();
  for (const c of shipped.cards || []) byId.set(c.id, c);
  for (const c of (user && user.cards) || []) byId.set(c.id, c);

  return { cards: [...byId.values()].filter((c) => !c.hidden) };
}

function loadState() {
  return readJson(path.join(paths.STATE_DIR, 'learn-state.json'), {}) || {};
}

function saveState(state) {
  writeJsonAtomic(path.join(paths.STATE_DIR, 'learn-state.json'), state);
}

const UNSEEN_BASE = 1e6;
const JITTER = 1e5;

function dueScore(card, state, now) {
  const st = state[card.id];
  // Unseen cards outrank everything, but with a finite score plus jitter rather
  // than Infinity. Infinity made every unseen card tie, so the sort fell back
  // to deck order and a fresh deck served six consecutive cards on one topic.
  if (!st) return UNSEEN_BASE + Math.random() * JITTER;
  const exposures = st.exposures || 0;
  const interval = Math.min(BASE_INTERVAL_MIN * 2 ** exposures, MAX_INTERVAL_MIN);
  const elapsedMin = (now - (st.lastSuppliedAt || 0)) / 60000;
  return elapsedMin - interval; // >0 means due; larger means more overdue
}

/** A card is relevant if its tag or explicit topics match the detected stack. */
function cardTopics(card) {
  const topics = new Set((card.topics || []).map((t) => String(t).toLowerCase()));
  if (card.tag) topics.add(String(card.tag).toLowerCase());
  return topics;
}

function isRelevant(card, detected) {
  if (!detected || detected.size === 0) return false;
  for (const t of cardTopics(card)) if (detected.has(t)) return true;
  return false;
}

async function collect(cfg, ctx) {
  const deck = loadDeck(ctx.pluginRoot);
  if (!deck.cards || deck.cards.length === 0) return { tips: [], status: [] };

  const state = loadState();
  const now = Date.now();
  const count = Math.max(1, cfg.count || 6);
  const detected = (ctx.context && ctx.context.topics) || new Set();

  const scored = deck.cards
    .map((card) => ({ card, score: dueScore(card, state, now), relevant: isRelevant(card, detected) }))
    .sort((a, b) => b.score - a.score);

  /**
   * Context earns a share of the slots, not all of them.
   *
   * Matching the current stack makes a card land harder — a Postgres note while
   * you're in a Postgres repo is worth more than one in the abstract. But if
   * relevance took every slot, the deck would collapse into a second work feed,
   * which is exactly what this surface shouldn't be. The idle seconds are the
   * one place a fact about tardigrades genuinely competes.
   */
  const contextShare = cfg.contextShare ?? 0.4;
  const maxRelevant = Math.min(count, Math.round(count * contextShare));

  // Draw from two pools rather than filtering one ranked list. A single list
  // only ever *caps* relevance; it never guarantees any, so on a fresh deck
  // context-matched cards lost every tie and never appeared at all.
  const relevantPool = scored.filter((e) => e.relevant);
  const generalPool = scored.filter((e) => !e.relevant);

  const picked = relevantPool.slice(0, maxRelevant);
  const seen = new Set(picked.map((e) => e.card.id));

  for (const entry of generalPool) {
    if (picked.length >= count) break;
    picked.push(entry);
    seen.add(entry.card.id);
  }
  // Top up from leftover relevant cards if the general pool ran dry.
  for (const entry of relevantPool) {
    if (picked.length >= count) break;
    if (!seen.has(entry.card.id)) { picked.push(entry); seen.add(entry.card.id); }
  }

  const ranked = picked;

  for (const { card } of ranked) {
    const st = state[card.id] || { exposures: 0 };
    st.exposures = (st.exposures || 0) + 1;
    st.lastSuppliedAt = now;
    state[card.id] = st;
  }
  saveState(state);

  // A fact with no way to go deeper is trivia. The line is the hook; the link
  // is what makes the surface worth the attention it takes.
  const tips = ranked.map(({ card }) => ({
    category: card.tag || 'Learn',
    text: card.text,
    action: card.action || null,
    url: card.url || null,
    source: 'learn',
  }));

  const warnings = [];
  const missing = ranked.filter(({ card }) => !card.url).length;
  if (missing > 0) warnings.push(`learn: ${missing} of ${ranked.length} supplied cards have no url`);

  return { tips, status: [], warnings };
}

module.exports = { name: 'learn', collect };
