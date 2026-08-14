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

// What sleep is doing for you, keyed to how late it is. These are the payload
// for late-night sessions: not "go to bed" but "here is what you're trading."
const SLEEP_SCIENCE = [
  {
    text: 'Deep sleep drives the glymphatic system, which clears metabolic waste from the brain — including amyloid-beta. Flow increases severalfold versus waking.',
    url: 'https://en.wikipedia.org/wiki/Glymphatic_system',
  },
  {
    text: 'Memory consolidation is a sleep process: slow-wave sleep replays the day\'s hippocampal traces into cortex. Studying without sleeping largely wastes the study.',
    url: 'https://en.wikipedia.org/wiki/Memory_consolidation',
  },
  {
    text: 'REM sleep is when the brain recombines material — it disproportionately helps with problems needing a non-obvious connection, which is most debugging.',
    url: 'https://en.wikipedia.org/wiki/Rapid_eye_movement_sleep',
  },
  {
    text: 'Most daily growth hormone is released in the first bout of slow-wave sleep. Cut the night short at the front and you lose that pulse outright.',
    url: 'https://en.wikipedia.org/wiki/Growth_hormone',
  },
  {
    text: 'Adenosine builds in the brain all day and creates sleep pressure; caffeine blocks its receptors without clearing it. The debt is still there when the caffeine wears off.',
    url: 'https://en.wikipedia.org/wiki/Adenosine',
  },
  {
    text: 'A single night of short sleep measurably reduces insulin sensitivity in healthy adults — the metabolic cost shows up immediately, not over years.',
    url: 'https://en.wikipedia.org/wiki/Sleep_deprivation',
  },
  {
    text: 'Sleep deprivation impairs vigilance on a dose-response curve, and self-rated sleepiness plateaus while performance keeps falling. You stop noticing before you stop declining.',
    url: 'https://en.wikipedia.org/wiki/Sleep_deprivation',
  },
  {
    text: 'Immune function tracks sleep: antibody response to vaccination is reduced in people sleeping short hours around the dose.',
    url: 'https://en.wikipedia.org/wiki/Sleep',
  },
  {
    text: 'You cannot fully repay sleep debt on weekends. Recovery sleep restores some vigilance but not the metabolic and attentional deficits.',
    url: 'https://en.wikipedia.org/wiki/Sleep_debt',
  },
  {
    text: 'Core body temperature must drop to initiate sleep. A warm shower an hour before bed helps by dilating peripheral vessels and dumping heat.',
    url: 'https://en.wikipedia.org/wiki/Thermoregulation',
  },
  {
    text: 'Melanopsin cells in the retina set your circadian clock and are most sensitive to blue-ish light. A bright screen at 1am is a dawn signal.',
    url: 'https://en.wikipedia.org/wiki/Melanopsin',
  },
  {
    text: 'Alcohol shortens sleep latency then suppresses REM and fragments the back half of the night. It sedates rather than rests.',
    url: 'https://en.wikipedia.org/wiki/Alcohol_and_health',
  },
  {
    text: 'Sleep spindles during stage 2 correlate with overnight gains in motor and procedural skill — the improvement you notice "sleeping on it" is measurable.',
    url: 'https://en.wikipedia.org/wiki/Sleep_spindle',
  },
  {
    text: 'Circadian misalignment — being awake in your biological night — impairs performance beyond what the hours lost alone explain.',
    url: 'https://en.wikipedia.org/wiki/Circadian_rhythm',
  },
];

const MOVEMENT = [
  {
    text: 'The 20-20-20 rule for screen strain: every 20 minutes, look at something 20 feet away for 20 seconds. It relaxes the ciliary muscle held tense by near focus.',
    url: 'https://en.wikipedia.org/wiki/Computer_vision_syndrome',
  },
  {
    text: 'Blink rate drops sharply during screen work, which is most of what dry, gritty eyes at the end of a session actually are.',
    url: 'https://en.wikipedia.org/wiki/Computer_vision_syndrome',
  },
  {
    text: 'Prolonged sitting has effects partly independent of whether you exercise — breaking it up matters separately from the workout.',
    url: 'https://en.wikipedia.org/wiki/Sedentary_lifestyle',
  },
  {
    text: 'Even a couple of minutes of walking every half hour meaningfully blunts the glucose spike from sitting through a long stretch.',
    url: 'https://en.wikipedia.org/wiki/Physical_activity',
  },
  {
    text: 'Mild dehydration — around 1–2% of body mass — is enough to measurably degrade attention and working memory.',
    url: 'https://en.wikipedia.org/wiki/Dehydration',
  },
  {
    text: 'Slow breathing at roughly six breaths per minute raises heart rate variability and shifts autonomic balance toward parasympathetic within minutes.',
    url: 'https://en.wikipedia.org/wiki/Heart_rate_variability',
  },
];

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
    for (const card of pickDistinct(SLEEP_SCIENCE, seed, n)) {
      tips.push({ category: 'Sleep', text: card.text, url: card.url, source: 'wellness' });
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
          text: `${hoursLeft.toFixed(1)}h until ${wake} — a full cycle is ~90m; sleeping now gets you ${Math.floor(hoursLeft / 1.5)} complete ones`,
          priority: 80,
          source: 'wellness',
        });
      }
    }
  }

  if (cfg.movement !== false) {
    const breakAfter = cfg.breakAfterHours ?? 1.5;
    if (hoursAtDesk >= breakAfter) {
      const card = pick(MOVEMENT, seed);
      tips.push({ category: 'Health', text: card.text, url: card.url, source: 'wellness' });
      status.push({
        text: `${hoursAtDesk.toFixed(1)}h at the desk · look 20ft away for 20s`,
        priority: 50,
        source: 'wellness',
      });
    }
  }

  return { tips, status };
}

module.exports = { name: 'wellness', collect, SLEEP_SCIENCE, MOVEMENT };
