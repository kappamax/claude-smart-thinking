#!/usr/bin/env node
'use strict';

/**
 * Verify every feed in the catalog (or a config's feed list) still parses.
 *
 * Feeds rot quietly: a publication moves platform and the URL 404s, or the
 * markup changes and the parser silently yields zero items. Either way the
 * source just stops contributing and looks identical to one never configured.
 *
 *   node bin/checkfeeds.js [path-to-catalog-or-config.json]
 */

const path = require('path');
const paths = require('../lib/paths');
const { readJson } = require('../lib/jsonio');
/**
 * A local parser, deliberately not imported from a provider.
 *
 * This used to require providers/news, and broke silently when that provider
 * was deleted — the checker is network-only so it is not in the unit suite, and
 * nothing noticed until it was run by hand. A checker with a dependency on
 * something it is not checking is a checker that can rot.
 */
function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];
  return blocks.map((b) => {
    const t = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(b);
    const cdata = t && /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(t[1]);
    const title = ((cdata ? cdata[1] : (t ? t[1] : '')) || '')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const atom = /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(b);
    const rss = /<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i.exec(b);
    const url = atom ? atom[1] : (rss && /^https?:/i.test(rss[1].trim()) ? rss[1].trim() : null);
    return { title, url };
  }).filter((i) => i.title);
}

const CONCURRENCY = 8;

function collectFeeds(doc) {
  const out = [];
  if (doc && doc.bundles) {
    for (const [key, bundle] of Object.entries(doc.bundles)) {
      for (const f of bundle.feeds || []) out.push({ ...f, bundle: key });
    }
  } else if (doc && doc.providers && doc.providers.news) {
    for (const f of doc.providers.news.feeds || []) {
      out.push(typeof f === 'string' ? { url: f, label: f } : f);
    }
  }
  return out;
}

async function check(feed) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(feed.url, {
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; smart-thinking-feedcheck/0.1)' },
    });
    if (!res.ok) return { ...feed, ok: false, why: `HTTP ${res.status}` };
    const items = parseFeed(await res.text());
    if (items.length === 0) return { ...feed, ok: false, why: 'parsed 0 items' };
    return { ...feed, ok: true, items: items.length, withUrl: items.filter((i) => i.url).length };
  } catch (err) {
    return { ...feed, ok: false, why: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const file = process.argv[2] || path.join(__dirname, '..', 'data', 'feeds.catalog.json');
  const doc = readJson(file, null);
  const feeds = collectFeeds(doc);
  if (feeds.length === 0) {
    console.error(`no feeds found in ${file}`);
    process.exit(2);
  }

  console.log(`checking ${feeds.length} feeds in ${file}\n`);
  const queue = feeds.slice();
  const results = [];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) results.push(await check(queue.shift()));
  }));

  results.sort((a, b) => (a.bundle || '').localeCompare(b.bundle || '')
    || (a.label || '').localeCompare(b.label || ''));

  for (const r of results) {
    const tag = `[${r.bundle || 'feeds'}]`.padEnd(18);
    if (r.ok) console.log(`  OK   ${tag} ${(r.label || r.url).padEnd(24)} items=${String(r.items).padStart(3)}`);
    else console.log(`  FAIL ${tag} ${(r.label || r.url).padEnd(24)} ${r.why}`);
  }

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} working`);
  if (bad.length) process.exitCode = 1;
}

main();
