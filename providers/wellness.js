'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('../lib/paths');
const { readJson, writeJsonAtomic } = require('../lib/jsonio');
const { formatHours } = require('../lib/format');

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

/**
 * Stronger evidence gets picked more often.
 *
 * "Evidence is how you select it" taken literally: an umbrella review of many
 * meta-analyses should surface more than a single cohort study. Weighting the
 * candidate pool is the mechanism, so the tier changes the odds of being said
 * rather than appearing in what is said.
 *
 * `contested` keeps a real weight on purpose. A widely-believed claim that the
 * literature disputes is among the most useful things this surface can say.
 */
const TIER_WEIGHT = {
  'umbrella-review': 4,
  'meta-analysis': 3,
  RCT: 3,
  contested: 3,
  cohort: 1,
};

function weighted(claims) {
  const out = [];
  for (const c of claims) {
    const n = TIER_WEIGHT[c.evidence] ?? 1;
    for (let i = 0; i < n; i += 1) out.push(c);
  }
  return out;
}

function stateFile() {
  return path.join(paths.STATE_DIR, 'wellness-state.json');
}

/**
 * Cap on how much one tick may credit.
 *
 * This provider only runs on a full refresh, which is contentMaxAgeMinutes
 * apart (20 by default) — not on the 90-second rotation. The cap therefore
 * has to exceed the refresh interval or a normal working stretch is credited
 * at a fraction of its length. It must also stay below idleResetMinutes (30),
 * so the ordering that matters is: refresh interval < step cap < idle reset.
 */
const MAX_STEP_MS = 25 * 60 * 1000;

/**
 * How long you have actually been working, not how long Claude Code has been open.
 *
 * The first version measured wall-clock from the first tick and reset only
 * after a 45-minute gap between ticks. But the status line re-renders on a
 * timer for as long as the session exists, so the chain of ticks never broke
 * and it happily reported "76.7h at the desk" for a window left open over a
 * weekend. Elapsed time was never the right quantity.
 *
 * Claude Code gives no signal for "the human is present". What it does give,
 * on the status line's stdin, is session cost and API duration — and those
 * only advance when Claude is actually doing work for you. So time is
 * accumulated only across ticks where one of them moved, in bounded steps, so
 * an idle window contributes nothing however long it stays open.
 *
 * Still a proxy: reading output without prompting counts as idle. It errs
 * toward under-counting, which is the right direction for a break reminder.
 */
function trackSession(now, activity = {}) {
  let state = readJson(stateFile(), {}) || {};
  const nowMs = now.getTime();

  const cost = Number(activity.cost) || 0;
  const apiMs = Number(activity.apiMs) || 0;
  const sessionId = activity.sessionId || null;

  // A new session restarts cost at zero, which would otherwise look like the
  // counters going backwards and suppress every subsequent tick.
  if (sessionId && state.sessionId && sessionId !== state.sessionId) state = { sessionId };
  if (sessionId) state.sessionId = sessionId;

  const gap = state.lastSeenAt ? nowMs - state.lastSeenAt : 0;
  const idleResetMs = (activity.idleResetMinutes ?? 30) * 60000;
  const advanced = cost > (state.lastCost ?? 0) || apiMs > (state.lastApiMs ?? 0);

  const resumedFromIdle = gap > idleResetMs;
  if (!state.activeMs || resumedFromIdle) state.activeMs = 0;
  // The idle gap itself was not working time, so the tick that ends it starts
  // the new stretch at zero rather than crediting a step for the interval.
  // Bounded step otherwise: a suspended laptop must not donate hours at once.
  if (advanced && gap > 0 && !resumedFromIdle) state.activeMs += Math.min(gap, MAX_STEP_MS);

  state.lastSeenAt = nowMs;
  state.lastCost = Math.max(cost, state.lastCost ?? 0);
  state.lastApiMs = Math.max(apiMs, state.lastApiMs ?? 0);

  try {
    fs.mkdirSync(paths.STATE_DIR, { recursive: true });
    writeJsonAtomic(stateFile(), state);
  } catch { /* tracking is best-effort */ }

  return { activeHours: (state.activeMs || 0) / 3600000 };
}

/**
 * Evidence decides what gets said. It is not part of what gets said.
 *
 * Tips used to end with "(meta-analysis)" or "(RCT)", which was the grading
 * leaking into the display — the same mistake as showing the raw URL. The
 * reader wants the thing worth knowing; the study design is how it earned the
 * slot, and belongs in the corpus, the audit and the ranking below.
 */
function toTip(claim) {
  return {
    category: claim.topic,
    text: claim.text,
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
  if (list.length === 0) return [];
  // Walking a weighted list can revisit the same claim, so distinctness is
  // enforced by id rather than assumed from the stride.
  const start = Math.abs(seed) % list.length;
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length && out.length < n; i += 1) {
    const c = list[(start + i) % list.length];
    const key = c.id ?? c.text ?? String(i);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

async function collect(cfg, ctx) {
  const claims = loadEvidence(ctx.pluginRoot || path.resolve(__dirname, '..'));
  const sleepClaims = weighted(claims.filter((c) => SLEEP_TOPICS.has(c.topic)));
  const dayClaims = weighted(claims.filter((c) => !SLEEP_TOPICS.has(c.topic)));

  const now = ctx.now || new Date();
  const hour = now.getHours();
  const { activeHours } = trackSession(now, ctx.activity || {});

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
          text: `${formatHours(hoursLeft)} until ${wake} — under 6h measurably impairs vigilance and next-day glucose handling`,
          priority: 80,
          source: 'wellness',
        });
      }
    }
  }

  /**
   * Health belongs in the rotation all day.
   *
   * Previously the only non-sleep health content was attached to the break
   * prompt, which fires after 90 minutes of measured work — so in practice
   * health showed up late at night and almost never otherwise. The corpus has
   * two dozen daytime claims; they should be competing for slots continuously.
   */
  const dayTipCount = Math.max(0, cfg.dayTipCount ?? 3);
  if (dayTipCount > 0 && dayClaims.length > 0) {
    for (const c of pickDistinct(dayClaims, seed + 3, dayTipCount)) tips.push(toTip(c));
  }

  if (cfg.movement !== false) {
    const breakAfter = cfg.breakAfterHours ?? 1.5;
    if (activeHours >= breakAfter && dayClaims.length > 0) {
      // Rotate through the corpus rather than repeating one nudge. A prompt
      // that says the same thing every ninety seconds gets tuned out, and
      // this surface only works while it still has the reader's trust.
      const [statusClaim] = pickDistinct(dayClaims, seed, 1);

      // The old text hardcoded "look 20ft away for 20s" — the 20-20-20 rule,
      // which this plugin's own corpus grades as contested after an RCT found
      // no significant effect. Advice on the status line now comes from the
      // same graded corpus as everything else.
      const advice = statusClaim;
      status.push({
        text: `${formatHours(activeHours)} active · ${advice.action}`,
        priority: 50,
        source: 'wellness',
      });
    }
  }

  return { tips, status };
}

module.exports = { name: 'wellness', collect, loadEvidence, _pickDistinct: pickDistinct };
