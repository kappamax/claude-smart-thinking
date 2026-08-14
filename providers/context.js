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

  const tips = cfg.introspect !== false ? introspect(cfg, ctx) : [];
  return { tips, status };
}

/**
 * Introspection prompts about the project you're in.
 *
 * Phrased as observations with an open question, not instructions. The plugin
 * can see that there's no tests/ directory; it cannot see whether that's
 * negligence or a deliberate call for a 400-line script, so it shouldn't
 * pretend to. The value is in surfacing the fact at a moment you're idle
 * enough to think about it.
 */
function introspect(cfg, ctx) {
  const c = ctx.context || {};
  const shape = c.shape || {};
  const git = c.git;
  const out = [];
  const name = c.projectName || 'this project';

  if (shape.codeFileCount && shape.codeLines) {
    const avg = Math.round(shape.codeLines / shape.codeFileCount);
    out.push(`${shape.codeLines.toLocaleString()} lines across ${shape.codeFileCount} code files, averaging ${avg}. Is the shape still what you'd choose starting today?`);
  }
  if (shape.fileCount && shape.hasTests === false) {
    out.push(`${shape.fileCount} tracked files and no test directory. Deliberate for something this size, or just never got started?`);
  }
  if (shape.hasTests && shape.hasCi === false) {
    out.push(`has tests but no CI workflow. Tests nobody runs on push tend to quietly stop passing.`);
  }
  if (shape.hasReadme === false) {
    out.push(`no README. The cost lands on whoever opens this next, which is usually you in six months.`);
  }
  if (git && git.dirty >= (cfg.introspectDirtyThreshold ?? 10)) {
    out.push(`${git.dirty} files uncommitted — large diffs are hard to review and harder to bisect. Is there a commit hiding in there that stands alone?`);
  }
  if (git && git.behind >= (cfg.behindWarnThreshold ?? 20)) {
    out.push(`${git.behind} commits behind upstream. The longer this branch runs, the more the merge costs.`);
  }

  return out.map((text) => ({ category: 'Project', text, source: 'context' }));
}

module.exports = { name: 'context', collect, introspect };
