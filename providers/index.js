'use strict';

const learn = require('./learn');
const weather = require('./weather');
const news = require('./news');
const context = require('./context');

const REGISTRY = { learn, weather, news, context };

/**
 * Run every enabled provider concurrently and isolate their failures.
 *
 * A provider is network-facing and third-party by nature; one unreachable feed
 * or a rate-limited weather API must degrade that source only. The refresh as a
 * whole succeeds as long as any provider returns, and the cache keeps serving
 * the previous content for the ones that didn't.
 */
async function collectAll(config, ctx) {
  const active = Object.entries(config.providers || {})
    .filter(([name, cfg]) => cfg && cfg.enabled && REGISTRY[name]);

  const settled = await Promise.allSettled(
    active.map(([name, cfg]) => REGISTRY[name].collect(cfg, ctx)),
  );

  const tips = [];
  const status = [];
  const errors = [];

  settled.forEach((res, i) => {
    const name = active[i][0];
    if (res.status === 'rejected') {
      errors.push(`${name}: ${res.reason && res.reason.message ? res.reason.message : res.reason}`);
      return;
    }
    for (const t of res.value.tips || []) tips.push({ ...t, source: t.source || name });
    for (const s of res.value.status || []) status.push({ ...s, source: s.source || name });
    // Partial failures inside a provider (one dead feed among several) are
    // reported alongside hard failures so they reach the log either way.
    for (const w of res.value.warnings || []) errors.push(w);
  });

  return { tips, status, errors };
}

/**
 * Round-robin by source so a 40-item news feed can't crowd out the six
 * learning cards. Ordering matters: Claude Code fills its rotation from the
 * front of the array, so an unbalanced list produces an unbalanced experience.
 */
function interleave(items, limit) {
  const bySource = new Map();
  for (const item of items) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source).push(item);
  }
  const queues = [...bySource.values()];
  const out = [];
  let added = true;
  while (out.length < limit && added) {
    added = false;
    for (const q of queues) {
      if (q.length === 0) continue;
      out.push(q.shift());
      added = true;
      if (out.length >= limit) break;
    }
  }
  return out;
}

module.exports = { collectAll, interleave, REGISTRY };
