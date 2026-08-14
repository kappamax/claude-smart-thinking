'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('../lib/paths');
const { readJson, writeJsonAtomic } = require('../lib/jsonio');

/**
 * Time-aware wellness content.
 *
 * The deck is deliberately context-free — a fact about tardigrades is equally
 * true at 10am and 2am. This provider is the opposite: everything it emits is
 * chosen *because* of when you're reading it. Sleep physiology is genuinely
 * interesting at 1am in a way it isn't at noon, and a movement prompt only
 * lands if you've actually been sitting for two hours.
 *
 * It escalates gently and then stops. A nag that fires every 90 seconds gets
 * tuned out, which would cost the whole surface its credibility.
 */

/**
 * Claims come from data/wellness.evidence.json, not from this file.
 *
 * Health is the one category where being interesting isn't enough: a
 * confidently-worded wrong claim about someone's body is worse than no claim.
 * Keeping the corpus as data means every entry carries its study design and a
 * PubMed link, and it can be audited in one place rather than read out of
 * string literals. Four claims that were previously hardcoded here turned out
 * to be pop-science — glymphatic clearance is actively disputed, and sitting
 * being harmful independent of exercise is contradicted by the largest
 * meta-analysis — so they were rewritten against the primary literature.
 */
function loadEvidence(pluginRoot) {
  const file = path.join(pluginRoot, 'data', 'wellness.evidence.json');
  const doc = readJson(file, null);
  return (doc && Array.isArray(doc.claims)) ? doc.claims : [];
}

const SLEEP_TOPICS = new Set(['Sleep']);

function stateFile() {
  return path.join(paths.STATE_DIR, 'wellness-state.json');
}

/**
 * Session length is inferred from the first time we ran today, persisted
 * across the many short-lived refresh processes. There's no session-duration
 * field available to a background refresh, so this is the honest proxy.
 */
function trackSession(now) {
  const state = readJson(stateFile(), {}) || {};
  const nowMs = now.getTime();
  const last = state.lastSeenAt || 0;
  // A gap longer than the idle window means a new working stretch.
  const IDLE_RESET_MS = 45 * 60 * 1000;
  if (!state.startedAt || nowMs - last > IDLE_RESET_MS) state.startedAt = nowMs;
  state.lastSeenAt = nowMs;
  try {
    fs.mkdirSync(paths.STATE_DIR, { recursive: true });
    writeJsonAtomic(stateFile(), state);
  } catch { /* tracking is best-effort */ }
  return { hoursAtDesk: (nowMs - state.startedAt) / 3600000 };
}

/** The study design travels with the claim — that's the whole point. */
function toTip(claim) {
  return {
    category: claim.topic,
    text: `${claim.text} (${claim.evidence})`,
    action: claim.action || null,
    url: claim.source,
    source: 'wellness',
  };
}

function pick(list, seed) {
  return list[Math.abs(seed) % list.length];
}

/**
 * n distinct items, walking forward from a seeded offset.
 *
 * The previous version indexed with a stride (seed + i * 7). Against a
 * 14-item list that stride shares a factor with the length, so it cycled
 * after two and asking for four sleep tips returned the same two twice.
 * Walking by 1 can't collide until the list is exhausted.
 */
function pickDistinct(list, seed, n) {
  const count = Math.min(n, list.length);
  const start = Math.abs(seed) % list.length;
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(list[(start + i) % list.length]);
  return out;
}

async function collect(cfg, ctx) {
  const claims = loadEvidence(ctx.pluginRoot || path.resolve(__dirname, '..'));
  const sleepClaims = claims.filter((c) => SLEEP_TOPICS.has(c.topic));
  const dayClaims = claims.filter((c) => !SLEEP_TOPICS.has(c.topic));

  const now = ctx.now || new Date();
  const hour = now.getHours();
  const { hoursAtDesk } = trackSession(now);

  const tips = [];
  const status = [];

  // Rotate deterministically off the clock so successive refreshes advance
  // rather than re-picking the same item.
  const seed = Math.floor(now.getTime() / 60000);

  const lateStart = cfg.lateNightStartHour ?? 22;
  const lateEnd = cfg.lateNightEndHour ?? 5;
  const isLateNight = hour >= lateStart || hour < lateEnd;

  if (isLateNight && cfg.sleep !== false) {
    // Weight sleep content heavily at night — this is the moment it's relevant.
    const n = Math.max(1, cfg.sleepTipCount ?? 4);
    for (const c of pickDistinct(sleepClaims, seed, n)) {
      tips.push(toTip(c));
    }

    // Hours until a target wake time, so the cost is concrete rather than moral.
    const wake = cfg.wakeTime || '07:00';
    const m = /^(\d{1,2}):(\d{2})$/.exec(wake);
    if (m) {
      const target = new Date(now);
      target.setHours(Number(m[1]), Number(m[2]), 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
      const hoursLeft = (target - now) / 3600000;
      if (hoursLeft < (cfg.sleepWarnHours ?? 7)) {
        status.push({
          // Deliberately not "N complete sleep cycles". Cycles run 70-120
          // minutes and lengthen through the night, so cycle arithmetic is
          // false precision. Total sleep duration is what the evidence is about.
          text: `${hoursLeft.toFixed(1)}h until ${wake} — under 6h measurably impairs vigilance and next-day glucose handling`,
          priority: 80,
          source: 'wellness',
        });
      }
    }
  }

  if (cfg.movement !== false) {
    const breakAfter = cfg.breakAfterHours ?? 1.5;
    if (hoursAtDesk >= breakAfter) {
      const c = pick(dayClaims, seed);
      if (c) tips.push(toTip(c));
      status.push({
        text: `${hoursAtDesk.toFixed(1)}h at the desk · look 20ft away for 20s`,
        priority: 50,
        source: 'wellness',
      });
    }
  }

  return { tips, status };
}

module.exports = { name: 'wellness', collect, loadEvidence, _pickDistinct: pickDistinct };
