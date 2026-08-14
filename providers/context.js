'use strict';

/**
 * Facts about the repo you're in right now.
 *
 * Scoped deliberately to state that changes under you and that a typical status
 * line doesn't already show. Branch name and directory are table stakes and
 * most people already have them; drift from upstream, uncommitted volume, and
 * a stale working tree are the things that quietly become a problem.
 */

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

async function collect(cfg, ctx) {
  const git = ctx.context && ctx.context.git;
  if (!git) return { tips: [], status: [] };

  const parts = [];
  const status = [];

  if (git.behind) parts.push(`${git.behind} behind`);
  if (git.ahead) parts.push(`${git.ahead} ahead`);
  if (git.dirty) parts.push(`${plural(git.dirty, 'file')} uncommitted`);

  if (parts.length) {
    // Drifting far from upstream is the case worth interrupting for: it's the
    // one that turns into a painful merge if it goes unnoticed all day.
    const behindThreshold = cfg.behindWarnThreshold ?? 20;
    const urgent = (git.behind || 0) >= behindThreshold
      || (git.dirty || 0) >= (cfg.dirtyWarnThreshold ?? 25);

    status.push({
      text: `${git.branch || 'detached'} · ${parts.join(' · ')}`,
      priority: urgent ? 60 : 20,
      source: 'context',
    });
  }

  if (git.lastCommitAgeHours !== null && git.lastCommitAgeHours >= (cfg.staleHours ?? 8) && git.dirty > 0) {
    const days = Math.floor(git.lastCommitAgeHours / 24);
    const age = days >= 1 ? `${plural(days, 'day')}` : `${Math.round(git.lastCommitAgeHours)}h`;
    status.push({
      text: `${plural(git.dirty, 'file')} uncommitted · last commit ${age} ago`,
      priority: 40,
      source: 'context',
    });
  }

  return { tips: [], status };
}

module.exports = { name: 'context', collect };
