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
const EUROPEPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

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
  // Manual therapy / complementary medicine: the biomedical generalists above
  // essentially never touch this domain, so topics like massage or manual
  // therapy returned nothing without --any-journal. These are the actual
  // peer-reviewed, PubMed-indexed journals for it — not trade magazines or CE
  // providers (Massage Therapy Journal and Precision Neuromuscular Therapy's
  // seminars are neither peer-reviewed nor PubMed-indexed, so they can't
  // satisfy the corpus's PubMed/NCBI source rule).
  'J Bodyw Mov Ther', 'J Manipulative Physiol Ther', 'Complement Ther Med',
  'J Integr Complement Med', 'Int J Ther Massage Bodywork',
  // Australia and Canada publish a disproportionate share of the manual
  // therapy / allied-health evidence base — J Physiother is the Australian
  // Physiotherapy Association's MEDLINE-indexed journal, J Can Chiropr Assoc
  // is the Canadian Chiropractic Association's open-access, PMC-indexed one.
  'J Physiother', 'J Can Chiropr Assoc',
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

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tag(xml, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? stripHtml(m[1]) : '';
}

// Systematic reviews and meta-analyses are the two review-level publication
// types this script looks for (see REVIEW_TYPES); everything else that
// slips through a text-based topic match is downgraded rather than dropped.
function classifyTier(publicationTypes) {
  const joined = publicationTypes.join(' ');
  if (/meta-analysis/i.test(joined)) return 'meta-analysis';
  if (/systematic review/i.test(joined)) return 'meta-analysis';
  return 'peer-reviewed';
}

function printCandidate({ id, link, journal, year, tier, title, abstract }) {
  console.log('─'.repeat(78));
  console.log(`${id}  ·  ${journal} ${year}  ·  suggested tier: ${tier}`);
  console.log(link);
  console.log(`\n${title}\n`);
  console.log(abstract ? abstract.slice(0, 2200) : '(no abstract indexed)');
  console.log('');
}

function pubmedCandidates(xml) {
  return xml.split('<PubmedArticle>').slice(1).map((article) => {
    const pmid = (/<PMID[^>]*>(\d+)<\/PMID>/.exec(article) || [])[1];
    const types = [...article.matchAll(/<PublicationType[^>]*>([^<]+)</g)].map((m) => m[1]);
    const abstract = [...article.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)]
      .map((m) => stripHtml(m[1]))
      .join(' ');
    return {
      id: `PMID ${pmid}`,
      link: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      journal: tag(article, 'Title'),
      year: (/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/.exec(article) || [])[1] || '',
      tier: classifyTier(types),
      title: tag(article, 'ArticleTitle'),
      abstract,
    };
  });
}

// Europe PMC is a separate index, not a mirror: it picks up preprints and
// some life-science journals PubMed's own search never surfaces. It's a
// fallback rather than the default because most of what it adds over a
// PubMed search is exactly the kind of source (preprints, non-peer-reviewed
// repositories) the corpus's PubMed/NCBI-only rule exists to exclude — so
// candidates without a PMID or PMCID are dropped here rather than printed,
// since there is no NCBI-resolvable link to cite them with.
async function fetchEuropePmc(topic, count) {
  const query = encodeURIComponent(
    `(TITLE:"${topic}" OR ABSTRACT:"${topic}") AND (PUB_TYPE:"systematic review" OR PUB_TYPE:"meta-analysis")`,
  );
  const data = await get(`${EUROPEPMC}?query=${query}&format=json&resultType=core&pageSize=${count}`);
  const results = (data.resultList && data.resultList.result) || [];
  return results
    .map((r) => {
      const pmid = r.pmid;
      const pmcid = r.pmcid;
      if (!pmid && !pmcid) return null;
      return {
        id: pmid ? `PMID ${pmid}` : pmcid,
        link: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/`,
        journal: (r.journalInfo && r.journalInfo.journal && r.journalInfo.journal.title) || r.source,
        year: r.pubYear || '',
        tier: classifyTier((r.pubTypeList && r.pubTypeList.pubType) || []),
        title: r.title || '',
        // Unlike PubMed's plain-text abstracts, Europe PMC's carry structural
        // HTML (<h4>Background</h4> etc.) that needs stripping the same way.
        abstract: stripHtml(r.abstractText || ''),
      };
    })
    .filter(Boolean);
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

  let candidates = [];
  let source = 'PubMed';
  if (ids.length > 0) {
    await pause();
    const xml = await get(`${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(',')}${ETIQUETTE}`, false);
    candidates = pubmedCandidates(xml);
  } else if (!anyJournal) {
    // The curated journal list is a filter, not the ceiling of what PubMed
    // has — try Europe PMC before giving up, since it turns up review-level
    // work (including from journals not on the curated list) that still
    // resolves to a PubMed or PMC link.
    source = 'Europe PMC';
    candidates = await fetchEuropePmc(topic, count);
  }

  if (candidates.length === 0) {
    if (anyJournal) {
      console.log(`No review-level results for "${topic}", even with --any-journal. Try a broader topic, and judge quality yourself.`);
    } else {
      console.log(`No review-level results for "${topic}" in the curated journal set or Europe PMC.`);
      console.log('Retry with --any-journal to widen the PubMed search, and judge quality yourself.');
    }
    return;
  }

  console.log(`${candidates.length} candidate(s) for "${topic}" (via ${source})\n`);
  for (const candidate of candidates) printCandidate(candidate);
}

main().catch((err) => {
  console.error(`research failed: ${err.message}`);
  process.exitCode = 1;
});
