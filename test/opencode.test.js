'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createOpenCodePlugin, expandHome, formatItem, pickItem } = require('../lib/opencode');

test('OpenCode formatting stays free of terminal escapes and retains links', () => {
  assert.deepStrictEqual(formatItem({
    category: 'Git', text: 'Reflog records HEAD moves.', action: 'Try git reflog.', url: 'https://git-scm.com/docs/git-reflog',
  }), {
    title: 'smart-thinking · Git',
    message: 'Reflog records HEAD moves. ▸ Try git reflog. → https://git-scm.com/docs/git-reflog',
  });
  assert.strictEqual(expandHome('~/state', '/home/me'), path.join('/home/me', 'state'));
});

test('OpenCode selection promotes urgent status and otherwise rotates cards', () => {
  const cache = {
    status: [{ text: 'normal', priority: 10 }],
    pool: [{ text: 'card one' }, { text: 'card two' }],
  };
  assert.strictEqual(pickItem(cache, 0).text, 'normal');
  assert.strictEqual(pickItem(cache, 1).text, 'card two');
  assert.strictEqual(pickItem({ ...cache, status: [{ text: 'urgent', priority: 60 }] }, 9).text, 'urgent');
});

test('OpenCode plugin shows content only while busy and clears its timer', async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-thinking-opencode-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(stateDir, 'cache.json'), JSON.stringify({
    generatedAt: 1000,
    pool: [{ category: 'Test', text: 'A useful card.', url: 'https://example.com' }],
    status: [],
  }));

  const toasts = [];
  const intervals = [];
  const cleared = [];
  const plugin = createOpenCodePlugin({
    root: '/plugin',
    deps: {
      now: () => 1000,
      setInterval: (fn, ms) => {
        const timer = { fn, ms };
        intervals.push(timer);
        return timer;
      },
      clearInterval: (timer) => cleared.push(timer),
      spawn: () => {
        throw new Error('fresh cache must not spawn a refresh');
      },
    },
  });
  const hooks = await plugin({
    directory: '/workspace',
    client: {
      app: { log: async () => true },
      tui: { showToast: async ({ body }) => { toasts.push(body); } },
    },
  }, { stateDir, rotationSeconds: 10, toastDurationMs: 3000 });

  await hooks.event({ event: {
    type: 'session.status', properties: { sessionID: 'one', status: { type: 'busy' } },
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(toasts.length, 1);
  assert.strictEqual(intervals.length, 1);
  assert.strictEqual(intervals[0].ms, 10000);
  assert.strictEqual(toasts[0].message, 'A useful card. → https://example.com');

  await hooks.event({ event: {
    type: 'session.status', properties: { sessionID: 'one', status: { type: 'busy' } },
  } });
  assert.strictEqual(intervals.length, 1, 'repeat busy events must not create timers');

  await hooks.event({ event: {
    type: 'session.status', properties: { sessionID: 'one', status: { type: 'retry', attempt: 1 } },
  } });
  assert.strictEqual(cleared.length, 0, 'a retry is still time spent waiting for the session');

  await hooks.event({ event: {
    type: 'session.idle', properties: { sessionID: 'one' },
  } });
  assert.deepStrictEqual(cleared, [intervals[0]]);
});

test('OpenCode refresh uses isolated state and never writes Claude settings', async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-thinking-opencode-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const children = [];
  const plugin = createOpenCodePlugin({
    root: '/plugin',
    deps: {
      now: () => 1000,
      setInterval: () => ({ id: 1 }),
      clearInterval: () => {},
      spawn: (command, args, options) => {
        const child = new EventEmitter();
        child.unref = () => {};
        children.push({ command, args, options, child });
        return child;
      },
    },
  });
  await plugin({
    directory: '/workspace',
    client: { app: { log: async () => true }, tui: { showToast: async () => true } },
  }, { stateDir });

  assert.strictEqual(children.length, 1);
  assert.deepStrictEqual(children[0].args, [
    '/plugin/bin/refresh.js', '--root', '/plugin', '--cwd', '/workspace', '--no-settings',
  ]);
  assert.strictEqual(children[0].options.env.SMART_THINKING_HOME, stateDir);
});


test('an expired status item is not shown, however long the cache sits', () => {
  /**
   * Regression: OpenCode toasted "2h 20m until 07:00" at half past noon. Two
   * causes — the refresh carried yesterday's status forward (fixed in
   * bin/refresh.js), and this adapter shows a cached item before the
   * stale-triggered refresh finishes, so an item whose moment has passed could
   * still surface. Providers stamp expiresAt; the reader has to honour it.
   */
  const cache = {
    status: [{ text: '2h 20m until 07:00', priority: 80, expiresAt: 1000 }],
    pool: [{ text: 'card one' }],
  };
  const picked = pickItem(cache, 0, 5000);
  assert.strictEqual(picked.text, 'card one', 'an expired urgent item must not pre-empt');
  assert.strictEqual(pickItem(cache, 0, 500).text, '2h 20m until 07:00', 'still live before it expires');
});
