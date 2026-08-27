'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn: nodeSpawn } = require('child_process');

function expandHome(value, home = os.homedir()) {
  if (value === '~') return home;
  if (value.startsWith('~/')) return path.join(home, value.slice(2));
  return path.resolve(value);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function formatItem(item) {
  if (!item || !item.text) return null;
  const action = item.action ? ` ▸ ${item.action}` : '';
  const url = item.url ? ` → ${item.url}` : '';
  return {
    title: item.category ? `smart-thinking · ${item.category}` : 'smart-thinking',
    message: `${item.text}${action}${url}`,
  };
}

function pickItem(cache, tick) {
  if (!cache) return null;
  const status = Array.isArray(cache.status) ? cache.status.filter((item) => item && item.text) : [];
  const urgent = status.filter((item) => (item.priority || 0) >= 60);
  if (urgent.length) return urgent[tick % urgent.length];
  if (status.length && tick % 4 === 0) return status[Math.floor(tick / 4) % status.length];

  const pool = Array.isArray(cache.pool) ? cache.pool.filter((item) => item && item.text) : [];
  if (pool.length) return pool[tick % pool.length];
  return status.length ? status[tick % status.length] : null;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function createOpenCodePlugin({ root, deps = {} }) {
  const spawn = deps.spawn || nodeSpawn;
  const setTimer = deps.setInterval || setInterval;
  const clearTimer = deps.clearInterval || clearInterval;
  const now = deps.now || Date.now;
  const home = deps.home || os.homedir();

  return async function SmartThinkingPlugin({ client, directory }, options = {}) {
    const stateDir = expandHome(
      typeof options.stateDir === 'string'
        ? options.stateDir
        : path.join(home, '.config', 'opencode', 'smart-thinking'),
      home,
    );
    const configFile = path.join(stateDir, 'config.json');
    const cacheFile = path.join(stateDir, 'cache.json');
    const config = readJson(configFile, {}) || {};
    const rotationSeconds = positiveNumber(options.rotationSeconds, config.rotateIntervalSeconds || 90);
    const rotationMs = rotationSeconds * 1000;
    const defaultToastDuration = Math.max(1000, Math.min(12000, rotationMs - 1000));
    const toastDurationMs = positiveNumber(options.toastDurationMs, defaultToastDuration);
    const maxAgeMs = positiveNumber(config.contentMaxAgeMinutes, 20) * 60 * 1000;
    const activeSessions = new Set();
    let timer = null;
    let refreshing = false;
    let tick = Math.floor(now() / rotationMs);

    const log = (level, message) => {
      try {
        Promise.resolve(client.app.log({
          body: { service: 'smart-thinking', level, message },
        })).catch(() => {});
      } catch {
        // Logging must not turn display decoration into a host failure.
      }
    };

    const show = async () => {
      const display = formatItem(pickItem(readJson(cacheFile), tick++));
      if (!display) return;
      try {
        await client.tui.showToast({
          body: { ...display, variant: 'info', duration: toastDurationMs },
        });
      } catch (error) {
        log('warn', `could not show content: ${error && error.message ? error.message : error}`);
      }
    };

    const refresh = () => {
      if (refreshing) return;
      refreshing = true;
      let child;
      try {
        child = spawn(process.env.SMART_THINKING_NODE || 'node', [
          path.join(root, 'bin', 'refresh.js'),
          '--root', root,
          '--cwd', directory,
          '--no-settings',
        ], {
          env: { ...process.env, SMART_THINKING_HOME: stateDir },
          stdio: 'ignore',
        });
        child.once('error', (error) => {
          refreshing = false;
          log('warn', `refresh failed to start: ${error.message}`);
        });
        child.once('exit', (code) => {
          refreshing = false;
          if (code === 0 && activeSessions.size) void show();
          else if (code) log('warn', `refresh exited with code ${code}`);
        });
        if (typeof child.unref === 'function') child.unref();
      } catch (error) {
        refreshing = false;
        log('warn', `refresh failed to start: ${error.message}`);
      }
    };

    const refreshIfStale = () => {
      const cache = readJson(cacheFile);
      const age = cache && cache.generatedAt ? now() - cache.generatedAt : Infinity;
      if (age > maxAgeMs) refresh();
    };

    const start = () => {
      if (timer) return;
      void show();
      refreshIfStale();
      timer = setTimer(() => {
        void show();
        refreshIfStale();
      }, rotationMs);
    };

    const stopIfIdle = () => {
      if (activeSessions.size || !timer) return;
      clearTimer(timer);
      timer = null;
    };

    refreshIfStale();

    return {
      event: async ({ event }) => {
        if (event.type === 'session.status') {
          const { sessionID, status } = event.properties;
          if (status.type === 'busy' || status.type === 'retry') {
            const wasIdle = activeSessions.size === 0;
            activeSessions.add(sessionID);
            if (wasIdle) start();
          } else {
            activeSessions.delete(sessionID);
            stopIfIdle();
          }
        } else if (event.type === 'session.idle') {
          activeSessions.delete(event.properties.sessionID);
          stopIfIdle();
        } else if (event.type === 'session.deleted') {
          activeSessions.delete(event.properties.info.id);
          stopIfIdle();
        }
      },
      dispose: async () => {
        activeSessions.clear();
        stopIfIdle();
      },
    };
  };
}

module.exports = { createOpenCodePlugin, expandHome, formatItem, pickItem };
