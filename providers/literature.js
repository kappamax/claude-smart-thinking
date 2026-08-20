'use strict';

const { fetchJson } = require('../lib/fetch');

/**
 * Live peer-reviewed literature, in place of news headlines.
 *
 * A feed item is a headline, and a headline is written to be clicked. "Study
 * reveals TikTok videos deactivate key cognitive brain regions" carries no
 * finding, no study design, no effect size and nothing to do about it — it is
 * marketing for an article, and no amount of curation at the publication level
 * fixes the unit. Titles from HN and NYT were the only content here that
 * couldn't state what it actually knew.
 *
 * This queries PubMed for review-level publications instead. Every item is
 * peer reviewed by construction, carries its publication type, and links the
 * record rather than somebody's writeup of it. It is also the only genuinely
 * live source in the plugin: the corpus is a static file, this is whatever
 * cleared review in the last few weeks.
 */

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

// Restricting to these publication types keeps the bar at review level rather
// than any single paper that happens to be new.
const REVIEW_TYPES = '("systematic review"[pt] OR "meta-analysis"[pt])';

/**
 * Peer review is necessary and not sufficient.
 *
 * The first version of this query returned the newest reviews on each topic and
 * produced things like "a bibliometric study of CBT-I publishing trends" and
 * "menopause and burning mouth syndrome: an updated review". Both are genuinely
 * peer reviewed and both are useless here — which is the headline problem again
 * wearing a lab coat. Credentials are not significance.
 *
 * The curated corpus works because entries were *selected* for mattering. A live
 * query has no such judgement, so the filter has to stand in for it: restrict to
 * journals whose review-level output is broadly consequential, and exclude the
 * genres that are about the literature rather than about the world.
 */
const JOURNALS = [
  'Cochrane Database Syst Rev', 'Lancet', 'BMJ', 'JAMA', 'N Engl J Med',
  'Nature', 'Science', 'Ann Intern Med', 'JAMA Intern Med', 'Nat Hum Behav',
  'Psychol Bull', 'Lancet Public Health', 'Nat Med',
].map((j) => `"${j}"[jour]`).join(' OR ');

// Genres that describe publishing activity rather than a finding.
const EXCLUDE = ['bibliometric', 'scoping review', 'protocol', 'study protocol']
  .map((t) => `${t}[ti]`).join(' OR ');

const TIER = [
  [/meta-?analysis/i, 'meta-analysis'],
  [/systematic review/i, 'systematic review'],
  [/randomized controlled trial|clinical trial/i, 'RCT'],
];

function tierOf(pubtypes) {
  const joined = (pubtypes || []).join(' ');
  for (const [re, label] of TIER) if (re.test(joined)) return label;
  return 'peer-reviewed';
}

async function collect(cfg, ctx) {
  const topics = (cfg.topics || []).filter(Boolean);
  if (topics.length === 0) return { tips: [], status: [] };

  const days = cfg.maxAgeDays ?? 60;
  const perTopic = Math.max(1, cfg.perTopic ?? 2);

  // NCBI allows roughly three requests a second without an API key, and the
  // first version fired every topic in parallel and got a 429. Serialised with
  // a gap, and identifying the caller as NCBI's usage policy asks.
  const ETIQUETTE = '&tool=claude-smart-thinking&email=plugins%40kirklashley.com';
  const pause = () => new Promise((r) => setTimeout(r, 400));

  const results = [];
  for (const topic of topics) {
    try {
      const term = encodeURIComponent(
        `${REVIEW_TYPES} AND (${topic}) AND (${JOURNALS}) NOT (${EXCLUDE})`,
      );
      const search = await fetchJson(
        `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=date&reldate=${days}&datetype=pdat`
        + `&retmax=${perTopic}&term=${term}${ETIQUETTE}`,
        { timeoutMs: 12000 },
      );
      const ids = (search.esearchresult && search.esearchresult.idlist) || [];
      if (ids.length === 0) { results.push({ status: 'fulfilled', value: { topic, items: [] } }); await pause(); continue; }
      await pause();

    const summary = await fetchJson(
      `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}${ETIQUETTE}`,
      { timeoutMs: 12000 },
    );
    const res = summary.result || {};
    const items = (res.uids || []).map((uid) => {
      const r = res[uid];
      const year = (r.pubdate || '').slice(0, 4);
      const journal = r.source || '';
      return {
        category: 'Research',
        // Journal, year and design give a title the context a headline lacks:
        // where it was published and what kind of study it was.
        text: `${(r.title || '').replace(/\.$/, '')} — ${journal} ${year} (${tierOf(r.pubtype)})`,
        url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
        source: 'literature',
        ts: Date.parse(r.sortpubdate || r.pubdate) || null,
      };
    });
      results.push({ status: 'fulfilled', value: { topic, items } });
    } catch (err) {
      results.push({ status: 'rejected', reason: err });
    }
    await pause();
  }

  const tips = [];
  const warnings = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      warnings.push(`literature: "${topics[i]}" failed — ${r.reason && r.reason.message}`);
      return;
    }
    if (r.value.items.length === 0) warnings.push(`literature: no reviews on "${topics[i]}" in ${days}d`);
    tips.push(...r.value.items);
  });

  // A paper can match several topics — obesity turns up under both nutrition
  // and exercise — so dedupe by record before ordering.
  const seen = new Set();
  const unique = tips.filter((t) => (seen.has(t.url) ? false : (seen.add(t.url), true)));

  unique.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return { tips: unique, status: [], warnings };
}

module.exports = { name: 'literature', collect, _tierOf: tierOf };
