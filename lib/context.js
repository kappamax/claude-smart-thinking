'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Detects what the user is actually working on, so content can respond to it.
 *
 * Claude Code has an internal relevance hook — a tip carries
 * `isRelevant: async () => boolean`, and marketplace plugins declare
 * `relevance.signals` matched against cwd, files read, and manifest deps. None
 * of that is reachable from user-supplied tips: those get wrapped as
 * `isRelevant: async () => true`.
 *
 * So relevance is computed here instead, at refresh time, and expressed by
 * *which* cards we supply rather than by a predicate Claude Code evaluates.
 */

function git(args, cwd) {
  try {
    const res = spawnSync('git', ['--no-optional-locks', '-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (res.status !== 0) return null;
    return (res.stdout || '').trim();
  } catch {
    return null;
  }
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Dependency/file fingerprints → topic slugs. Topics are matched against card
// tags, so the vocabulary here and the tags in the deck have to agree.
const DEP_TOPICS = [
  [/\breact\b/i, 'react'], [/\bvue\b/i, 'vue'], [/\bsvelte\b/i, 'svelte'],
  [/\bnext\b/i, 'react'], [/\btypescript\b/i, 'typescript'],
  [/"pg"|\bpsycopg|\bpostgres/i, 'postgres'], [/\bmysql\b/i, 'sql'],
  [/\bsqlite\b/i, 'sql'], [/\bprisma\b|\bsequelize\b|\btypeorm\b|\bsqlalchemy\b/i, 'sql'],
  [/\bredis\b/i, 'distributed'], [/\bkafka\b/i, 'distributed'],
  [/\bgraphql\b/i, 'http'], [/\bexpress\b|\bfastify\b|\bflask\b|\bfastapi\b|\bdjango\b/i, 'http'],
  [/\bjest\b|\bvitest\b|\bpytest\b|\bmocha\b/i, 'reliability'],
  [/\bpandas\b|\bnumpy\b|\bscipy\b/i, 'statistics'],
  [/\bscikit-learn\b|\btorch\b|\btensorflow\b/i, 'statistics'],
  [/\bcrypto\b|\bbcrypt\b|\bargon2\b|\bjsonwebtoken\b/i, 'security'],
];

const FILE_TOPICS = [
  ['go.mod', 'go'], ['Cargo.toml', 'rust'], ['Gemfile', 'ruby'],
  ['pom.xml', 'java'], ['build.gradle', 'java'], ['composer.json', 'php'],
  ['Dockerfile', 'docker'], ['docker-compose.yml', 'docker'],
  ['requirements.txt', 'python'], ['pyproject.toml', 'python'],
  ['Makefile', 'shell'],
];

function detectTopics(root) {
  const topics = new Set();

  for (const [file, topic] of FILE_TOPICS) {
    if (fs.existsSync(path.join(root, file))) topics.add(topic);
  }

  const pkgRaw = readIfExists(path.join(root, 'package.json'));
  if (pkgRaw) {
    topics.add('javascript');
    try {
      const pkg = JSON.parse(pkgRaw);
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(' ');
      for (const [re, topic] of DEP_TOPICS) if (re.test(deps)) topics.add(topic);
    } catch { /* an unparseable package.json still tells us it's a JS project */ }
  }

  for (const manifest of ['requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'Gemfile']) {
    const raw = readIfExists(path.join(root, manifest));
    if (!raw) continue;
    for (const [re, topic] of DEP_TOPICS) if (re.test(raw)) topics.add(topic);
  }

  // Any git repo makes git cards relevant; SQL files make SQL cards relevant.
  if (fs.existsSync(path.join(root, '.git'))) topics.add('git');
  for (const dir of ['migrations', 'db/migrate', 'sql']) {
    if (fs.existsSync(path.join(root, dir))) { topics.add('sql'); break; }
  }

  return topics;
}

function detectGit(root) {
  if (!git(['rev-parse', '--is-inside-work-tree'], root)) return null;

  const branch = git(['branch', '--show-current'], root) || null;
  const porcelain = git(['status', '--porcelain'], root);
  const dirty = porcelain ? porcelain.split('\n').filter(Boolean).length : 0;

  let ahead = null;
  let behind = null;
  const counts = git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], root);
  if (counts) {
    const [a, b] = counts.split(/\s+/).map(Number);
    if (Number.isFinite(a)) ahead = a;
    if (Number.isFinite(b)) behind = b;
  }

  // A repo with no commits yet makes `git log` exit non-zero, and Number(null)
  // is 0 — which silently dates the last commit to 1970. Check the raw value.
  const lastCommitRaw = git(['log', '-1', '--format=%ct'], root);
  const lastCommitEpoch = lastCommitRaw ? Number(lastCommitRaw) : NaN;
  const lastCommitAgeHours = Number.isFinite(lastCommitEpoch) && lastCommitEpoch > 0
    ? (Date.now() / 1000 - lastCommitEpoch) / 3600
    : null;

  return { branch, dirty, ahead, behind, lastCommitAgeHours };
}

/**
 * Shape of the project, for introspection prompts.
 *
 * Restricted to facts a tool can establish and a person can act on: how big
 * the thing has got, whether it has tests, how much is uncommitted. Anything
 * resembling a quality judgement is left out — "this file is too long" depends
 * on what the file does, and a spinner has no way to know that.
 */
function detectShape(root, git) {
  const shape = {};
  try {
    const res = spawnSync('git', ['--no-optional-locks', '-C', root, 'ls-files'], {
      encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (res.status !== 0) return shape;
    const files = (res.stdout || '').split('\n').filter(Boolean);
    if (files.length === 0) return shape;

    shape.fileCount = files.length;
    shape.hasTests = files.some((f) => /(^|\/)(tests?|spec|__tests__)\//i.test(f)
      || /\.(test|spec)\.[a-z]+$/i.test(f));
    shape.hasCi = files.some((f) => f.startsWith('.github/workflows/'));
    shape.hasReadme = files.some((f) => /^readme\.md$/i.test(f));
    shape.hasLicense = files.some((f) => /^licen[cs]e/i.test(f));

    const code = files.filter((f) => /\.(js|mjs|cjs|ts|tsx|jsx|py|go|rb|rs|java|php|sh)$/i.test(f));
    shape.codeFileCount = code.length;

    let lines = 0;
    for (const f of code.slice(0, 400)) {
      try {
        lines += fs.readFileSync(path.join(root, f), 'utf8').split('\n').length;
      } catch { /* deleted or unreadable; skip */ }
    }
    shape.codeLines = lines;
  } catch { /* not a repo, or git unavailable */ }
  return shape;
}

/** Cheap enough to run every refresh; nothing here touches the network. */
function detect(cwd) {
  const root = cwd || process.cwd();
  let topics = new Set();
  let gitInfo = null;
  try { topics = detectTopics(root); } catch { /* unreadable dir: no topics */ }
  try { gitInfo = detectGit(root); } catch { /* not a repo, or git missing */ }

  let shape = {};
  try { shape = detectShape(root, gitInfo); } catch { /* best-effort */ }

  return {
    root,
    projectName: path.basename(root),
    topics,
    git: gitInfo,
    shape,
  };
}

module.exports = { detect, detectTopics, detectGit, detectShape };
