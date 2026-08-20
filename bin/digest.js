#!/usr/bin/env node
'use strict';

/**
 * Read the curated feeds and follow the links, so a person can turn what is
 * actually in the articles into cards.
 *
 * The news provider surfaced titles at render time and was removed, because a
 * headline is written to be clicked and cannot state a finding. "TrueForge –
 * The open-source agent harness" tells a reader nothing, and putting it in a
 * teaching slot advertises something nobody read.
 *
 * News is still good material. What it is not is good *tips*. So this fetches
 * the feed, follows each link, strips the article to text, and prints enough
 * for whoever runs /thinking-digest to judge whether there is something worth
 * teaching in it — and to write the card themselves, with the mechanism and the
 * action that a title can never carry.
 *
 *   node bin/digest.js --bundle deep-eng --limit 4
 *   node bin/digest.js --feed https://jvns.ca/atom.xml --limit 2
 */

const path = require('path');
const { readJson } = require('../lib/jsonio');

const UA = 'Mozilla/5.0 (compatible; smart-thinking-digest/0.1)';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function get(url, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ac.signal, headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];
  return blocks.map((b) => {
    const t = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(b);
    const cd = t && /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(t[1]);
    const title = ((cd ? cd[1] : (t ? t[1] : '')) || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const atom = /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(b);
    const rss = /<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i.exec(b);
    const url = atom ? atom[1] : (rss && /^https?:/i.test(rss[1].trim()) ? rss[1].trim() : null);
    return { title, url };
  }).filter((i) => i.title && i.url);
}

/**
 * Crude but sufficient: drop scripts, styles and tags, collapse whitespace.
 * The reader only needs enough prose to judge whether there is a finding here.
 */
function toText(html) {
  return html
    .replace(/<(script|style|nav|footer|header|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39|#x27);/g, (m) => (
      { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" }[m] || ' '
    ))
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const limit = Number(arg('--limit', '3'));
  const one = arg('--feed');
  const bundleName = arg('--bundle');

  let feeds = [];
  if (one) {
    feeds = [{ label: one, url: one }];
  } else {
    const catalog = readJson(path.join(__dirname, '..', 'data', 'feeds.catalog.json'), null);
    if (!catalog) { console.error('no feed catalog found'); process.exit(2); }
    const bundles = bundleName ? { [bundleName]: catalog.bundles[bundleName] } : catalog.bundles;
    if (bundleName && !catalog.bundles[bundleName]) {
      console.error(`unknown bundle "${bundleName}". Available: ${Object.keys(catalog.bundles).join(', ')}`);
      process.exit(2);
    }
    feeds = Object.values(bundles).flatMap((b) => b.feeds);
  }

  for (const feed of feeds.slice(0, bundleName || one ? feeds.length : 3)) {
    let items = [];
    try {
      items = parseFeed(await get(feed.url)).slice(0, limit);
    } catch (err) {
      console.log(`\n## ${feed.label} — feed unreachable (${err.message})`);
      continue;
    }
    console.log(`\n${'='.repeat(78)}\n## ${feed.label}\n`);
    for (const item of items) {
      console.log('─'.repeat(78));
      console.log(`${item.title}\n${item.url}\n`);
      try {
        const text = toText(await get(item.url));
        // Enough to judge, not so much that the useful part is buried.
        console.log(text.slice(0, 2500));
      } catch (err) {
        // Plenty of publishers block automated clients. Say so rather than
        // letting a missing body look like an empty article.
        console.log(`(could not fetch article body: ${err.message} — open it yourself before writing a card)`);
      }
      console.log('');
    }
  }
}

main().catch((err) => {
  console.error(`digest failed: ${err.message}`);
  process.exitCode = 1;
});
