'use strict';

const { fetchText } = require('../lib/fetch');

/**
 * Deliberately a headline reader, not an article reader.
 *
 * A tip is one line in a spinner; there is no room for a summary and no way to
 * click through. Pulling full article bodies would mean fetching, extracting,
 * and summarizing text nobody can act on from this surface. Titles from feeds
 * the user already chose to follow is the honest scope.
 */

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ',
};

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function tagContent(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(block);
  if (!m) return null;
  let v = m[1];
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(v);
  if (cdata) v = cdata[1];
  return decode(v.replace(/<[^>]+>/g, ''));
}

/**
 * RSS puts the URL in <link>text</link>; Atom puts it in a <link href="..."/>
 * attribute, often alongside other rel values. A headline the reader can't
 * open is the least useful thing this surface could show, so both are handled.
 */
function extractLink(block) {
  const atomAlt = /<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i.exec(block)
    || /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']alternate["']/i.exec(block);
  if (atomAlt) return decode(atomAlt[1]);

  const rss = tagContent(block, 'link');
  if (rss && /^https?:\/\//i.test(rss)) return rss;

  const anyHref = /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(block);
  if (anyHref) return decode(anyHref[1]);

  const guid = tagContent(block, 'guid');
  if (guid && /^https?:\/\//i.test(guid)) return guid;

  return null;
}

function parseFeed(xml) {
  // Handles RSS <item> and Atom <entry> with the same shape.
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];
  const out = [];
  for (const block of blocks) {
    const title = tagContent(block, 'title');
    if (!title) continue;
    const dateStr = tagContent(block, 'pubDate')
      || tagContent(block, 'published')
      || tagContent(block, 'updated')
      || tagContent(block, 'dc:date');
    const ts = dateStr ? Date.parse(dateStr) : NaN;
    out.push({ title, url: extractLink(block), ts: Number.isNaN(ts) ? null : ts });
  }
  return out;
}

async function collect(cfg, ctx) {
  const feeds = Array.isArray(cfg.feeds) ? cfg.feeds.filter(Boolean) : [];
  if (feeds.length === 0) return { tips: [], status: [] };

  const maxAgeMs = (cfg.maxAgeHours ?? 24) * 3600 * 1000;
  const now = (ctx.now || new Date()).getTime();
  const perFeed = cfg.maxPerFeed ?? 3;

  const urlOf = (feed) => (typeof feed === 'string' ? feed : feed.url);

  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      const url = urlOf(feed);
      const label = typeof feed === 'string' ? null : feed.label;
      // Feed hosts are frequently slow on a cold hit; 6s was tight enough that
      // healthy feeds were being dropped as if they were broken.
      const xml = await fetchText(url, { timeoutMs: 10000 });
      const parsed = parseFeed(xml);
      const fresh = parsed
        .filter((it) => it.ts === null || now - it.ts <= maxAgeMs)
        .slice(0, perFeed)
        .map((it) => ({
          category: label || 'News',
          text: it.title,
          url: it.url,
          source: 'news',
          ts: it.ts,
        }));
      return { url, parsed: parsed.length, fresh };
    }),
  );

  const tips = [];
  const warnings = [];

  results.forEach((r, i) => {
    const url = urlOf(feeds[i]);
    // One dead feed must not take down the whole refresh — but it must not
    // vanish silently either. A feed that quietly stops contributing looks
    // identical to one that was never configured.
    if (r.status === 'rejected') {
      warnings.push(`news: ${url} failed — ${r.reason && r.reason.message ? r.reason.message : r.reason}`);
      return;
    }
    if (r.value.parsed === 0) warnings.push(`news: ${url} returned no parseable items`);
    else if (r.value.fresh.length === 0) warnings.push(`news: ${url} had no items newer than ${cfg.maxAgeHours ?? 24}h`);
    tips.push(...r.value.fresh);
  });

  tips.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return { tips, status: [], warnings };
}

module.exports = { name: 'news', collect, _parseFeed: parseFeed };
