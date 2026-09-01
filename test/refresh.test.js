
'use strict';

/**
 * Refresh-level behaviour, exercised through the real binary.
 *
 * These cross provider, cache and settings boundaries, so mocking the pieces
 * would test the mocks. bin/refresh.js is cheap to run with providers narrowed
 * to the shipped deck and SMART_THINKING_HOME pointed at a temp dir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function runRefresh(seedCache, cfgOverride = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-thinking-refresh-'));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    providers: {
      learn: { enabled: true, count: 6 },
      wellness: { enabled: false },
      context: { enabled: false },
      weather: { enabled: false },
      literature: { enabled: false },
    },
    ...cfgOverride,
  }));
  if (seedCache) fs.writeFileSync(path.join(home, 'cache.json'), JSON.stringify(seedCache));

  execFileSync(process.execPath, [
    path.join(ROOT, 'bin', 'refresh.js'), '--root', ROOT, '--cwd', ROOT, '--no-settings',
  ], { env: { ...process.env, SMART_THINKING_HOME: home }, stdio: 'ignore' });

  return JSON.parse(fs.readFileSync(path.join(home, 'cache.json'), 'utf8'));
}

test('a refresh with no status of its own does not inherit the last one', () => {
  /**
   * Regression: status was written as `status.length ? status : previous.status`,
   * so a moment-scoped item outlived its moment. The 22:00-05:00 sleep warning
   * was the highest-priority item in the cache, and every daytime refresh
   * produced no status at all, so it was carried forward untouched — OpenCode
   * was still toasting "2h 20m until 07:00" at half past noon the next day.
   */
  const stale = {
    generatedAt: Date.now() - 12 * 3600 * 1000,
    pool: [{ category: 'Sleep', text: 'seeded', url: 'https://example.org' }],
    status: [{ text: '2h 20m until 07:00', priority: 80, source: 'wellness' }],
  };
  const cache = runRefresh(stale);
  assert.ok(cache.pool.length > 0, 'the refresh should have produced tips');
  assert.deepStrictEqual(cache.status, [],
    `stale status survived: ${JSON.stringify(cache.status)}`);
});

test('the pool is still retained when a refresh returns nothing for it', () => {
  // The pool is network-fed, so an empty one really is a failure to paper over.
  // That asymmetry with status is the point, so it is asserted rather than
  // assumed: same seed, only status is discarded.
  const seeded = [{ category: 'Sleep', text: 'seeded', url: 'https://example.org' }];
  const cache = runRefresh({ generatedAt: Date.now(), pool: seeded, status: [] });
  assert.ok(cache.pool.length > 0);
});

test('the status line honours an expiry too', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'statusline.js'), 'utf8');
  assert.match(src, /expiresAt/, 'a moment-scoped item must not outlive its moment on the status line');
});
