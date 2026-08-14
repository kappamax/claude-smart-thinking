'use strict';

/**
 * fetch with a hard timeout. Every provider runs on the refresh path, which is
 * detached from rendering — but a hung socket would still keep a stale lock
 * around, so nothing is allowed to block indefinitely.
 */
async function fetchText(url, { timeoutMs = 6000, headers = {} } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'user-agent': 'claude-smart-thinking/0.1', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

module.exports = { fetchText, fetchJson };
