#!/usr/bin/env node
'use strict';

/**
 * Find review-level evidence on a topic and print it with abstracts.
 *
 * This is the mechanical half of /thinking-research. The literature provider
 * failed twice because it tried to turn papers into tips at render time, and a
 * paper title is not a finding — Cochrane titles are deliberately
 * non-committal because the conclusion lives in the abstract. Nothing automated
 * can read the abstract and decide what is worth saying.
 *
 * So this script does only what a script can do well: search, filter to
 * review-level work in journals whose output is broadly consequential, and
 * print the abstracts. A person (or a model, once) reads them and writes the
 * corpus entry. The judgement happens once, not on every refresh.
 *
 *   node bin/research.js "burnout" --count 6
 */

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const ETIQUETTE = '&tool=claude-smart-thinking&email=plugins%40kirklashley.com';

const REVIEW_TYPES = '("systematic review"[pt] OR "meta-analysis"[pt])';

// Journals whose review-level output is broadly consequential. Not a ranking —
// a filter against the long tail of narrow reviews that are peer reviewed and
// of no use to a general reader.
const JOURNALS = [
  'Cochrane Database Syst Rev', 'Lancet', 'BMJ', 'JAMA', 'N Engl J Med',
  'Nature', 'Science', 'Ann Intern Med', 'JAMA Intern Med', 'JAMA Psychiatry',
  'Nat Hum Behav', 'Psychol Bull', 'Lancet Psychiatry', 'Lancet Public Health',
  'Nat Med', 'World Psychiatry', 'Annu Rev Psychol', 'Eur J Epidemiol',
  'Int J Epidemiol', 'Sleep Med Rev', 'Br J Sports Med',
].map((j) => `"${j}"[jour]`).join(' OR ');

const EXCLUDE = ['bibliometric', 'scoping review', 'protocol', 'study protocol']
  .map((t) => `${t}[ti]`).join(' OR ');

const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function get(url, asJson = true) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25000);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'smart-thinking-research/0.1' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return asJson ? res.json() : res.text();
  } finally {
    clearTimeout(timer);
  }
}

function tag(xml, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

async function main() {
  const args = process.argv.slice(2);
  const topic = args.filter((a) => !a.startsWith('--'))[0];
  const ci = args.indexOf('--count');
  const count = ci !== -1 ? Number(args[ci + 1]) : 6;
  const anyJournal = args.includes('--any-journal');

  if (!topic) {
    console.error('usage: node bin/research.js "<topic>" [--count N] [--any-journal]');
    process.exit(2);
  }

  const journalClause = anyJournal ? '' : ` AND (${JOURNALS})`;
  const term = encodeURIComponent(`${REVIEW_TYPES} AND (${topic})${journalClause} NOT (${EXCLUDE})`);
  const search = await get(
    `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${count}&term=${term}${ETIQUETTE}`,
  );
  const ids = (search.esearchresult && search.esearchresult.idlist) || [];

  if (ids.length === 0) {
    console.log(`No review-level results for "${topic}" in the curated journal set.`);
    console.log('Retry with --any-journal to widen it, and judge quality yourself.');
    return;
  }
  await pause();

  const xml = await get(`${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(',')}${ETIQUETTE}`, false);

  console.log(`${ids.length} candidate(s) for "${topic}"\n`);
  for (const article of xml.split('<PubmedArticle>').slice(1)) {
    const pmid = (/<PMID[^>]*>(\d+)<\/PMID>/.exec(article) || [])[1];
    const title = tag(article, 'ArticleTitle');
    const journal = tag(article, 'Title');
    const year = (/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/.exec(article) || [])[1] || '';
    const types = [...article.matchAll(/<PublicationType[^>]*>([^<]+)</g)].map((m) => m[1]);
    const tier = /Meta-Analysis/i.test(types.join(' ')) ? 'meta-analysis'
      : /Systematic Review/i.test(types.join(' ')) ? 'meta-analysis' : 'peer-reviewed';

    // The abstract is the point. Everything above it is metadata.
    const abstract = [...article.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .join(' ');

    console.log('─'.repeat(78));
    console.log(`PMID ${pmid}  ·  ${journal} ${year}  ·  suggested tier: ${tier}`);
    console.log(`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`);
    console.log(`\n${title}\n`);
    console.log(abstract ? abstract.slice(0, 2200) : '(no abstract indexed)');
    console.log('');
  }
}

main().catch((err) => {
  console.error(`research failed: ${err.message}`);
  process.exitCode = 1;
});
