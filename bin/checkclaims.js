#!/usr/bin/env node
'use strict';

/**
 * Audit the health corpus against PubMed.
 *
 * The corpus is a static file, but the literature under it is not. A claim can
 * become wrong in three ways after it ships, and only one of them is visible
 * from inside this repo:
 *
 *   1. The paper is retracted, corrected, or gets an expression of concern.
 *      Checkable, and the worst failure mode — the plugin would keep asserting
 *      something the record has withdrawn.
 *   2. Newer, better evidence overturns it. Not automatable; the glymphatic
 *      claim went from consensus to disputed in a single 2024 paper. What is
 *      automatable is flagging claims nobody has re-read in a long time.
 *   3. The link rots. Covered by bin/checklinks.js.
 *
 *   node bin/checkclaims.js [--max-age-days N]
 */

const path = require('path');
const { readJson } = require('../lib/jsonio');

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const DEFAULT_MAX_AGE_DAYS = 365;

function pmidOf(source) {
  const m = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/.exec(source || '');
  return m ? m[1] : null;
}

async function fetchJson(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'smart-thinking-claimcheck/0.1' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'smart-thinking-claimcheck/0.1' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Severity matters here, and the first version of this tool got it wrong.
 *
 * A retraction or expression of concern means the record has withdrawn the
 * finding — the claim has to go. An erratum usually fixes a figure, an
 * affiliation or a typo, and says nothing about whether the result holds.
 * Treating them alike flagged eight healthy papers as failures and would have
 * left CI permanently red, which trains people to ignore it.
 *
 * Two independent signals are used, because neither alone is reliable:
 * publication type carries "Retracted Publication", while the record's
 * comments-and-corrections list carries RetractionIn / ErratumIn pointers that
 * can appear before the type is updated.
 */
async function auditPubmed(pmids) {
  const problems = new Map();

  const add = (pmid, severity, note) => {
    if (!problems.has(pmid)) problems.set(pmid, { severity: 'notice', notes: [] });
    const entry = problems.get(pmid);
    if (severity === 'critical') entry.severity = 'critical';
    if (!entry.notes.includes(note)) entry.notes.push(note);
  };

  const summary = await fetchJson(`${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${pmids.join(',')}`);
  const result = summary.result || {};
  for (const uid of result.uids || []) {
    const types = (result[uid].pubtype || []).map((t) => t.toLowerCase());
    for (const t of types) {
      if (/retract|expression of concern/.test(t)) add(uid, 'critical', `publication type: ${t}`);
    }
  }

  const xml = await fetchText(`${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${pmids.join(',')}`);
  for (const article of xml.split('<PubmedArticle>').slice(1)) {
    const pmid = (/<PMID[^>]*>(\d+)<\/PMID>/.exec(article) || [])[1];
    if (!pmid) continue;
    // Capture the cited source too, so a reviewer can see what the note is
    // without opening the record.
    const re = /<CommentsCorrections RefType="(RetractionIn|ErratumIn|ExpressionOfConcernIn)">([\s\S]*?)<\/CommentsCorrections>/g;
    for (const m of article.matchAll(re)) {
      const src = (/<RefSource>([\s\S]*?)<\/RefSource>/.exec(m[2]) || [])[1] || '';
      const critical = m[1] !== 'ErratumIn';
      add(pmid, critical ? 'critical' : 'notice', `${m[1]}: ${src.trim().slice(0, 70)}`);
    }
  }

  return problems;
}

function daysSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

async function main() {
  const argMax = process.argv.indexOf('--max-age-days');
  const maxAge = argMax !== -1 ? Number(process.argv[argMax + 1]) : DEFAULT_MAX_AGE_DAYS;

  const file = path.join(__dirname, '..', 'data', 'wellness.evidence.json');
  const corpus = readJson(file, null);
  if (!corpus) {
    console.error(`no corpus at ${file}`);
    process.exit(2);
  }

  const withPmid = corpus.claims.map((c) => ({ claim: c, pmid: pmidOf(c.source) }));
  const pmids = withPmid.filter((x) => x.pmid).map((x) => x.pmid);
  const noPmid = withPmid.filter((x) => !x.pmid);

  console.log(`auditing ${corpus.claims.length} claims (${pmids.length} with a PMID)\n`);

  const problems = await auditPubmed(pmids);

  const critical = withPmid.filter(({ pmid }) => problems.get(pmid)?.severity === 'critical');
  const notices = withPmid.filter(({ pmid }) => problems.get(pmid)?.severity === 'notice');

  const failed = critical.length > 0;
  if (failed) {
    console.log('RETRACTED OR UNDER CONCERN — these claims must be pulled or rewritten:');
    for (const { claim, pmid } of critical) {
      console.log(`  ${claim.id}`);
      for (const n of problems.get(pmid).notes) console.log(`    ${n}`);
      console.log(`    ${claim.source}`);
    }
    console.log('');
  } else {
    console.log(`no retractions or expressions of concern across ${pmids.length} papers`);
  }

  if (notices.length) {
    console.log(`\n${notices.length} paper(s) carry an erratum — usually a figure or affiliation`);
    console.log('fix rather than a change to the result, but worth an eye:');
    for (const { claim, pmid } of notices) {
      console.log(`  ${claim.id.padEnd(28)} ${problems.get(pmid).notes.join(' | ')}`);
    }
  }

  const stale = withPmid
    .map(({ claim }) => ({ claim, age: daysSince(claim.verified) }))
    .filter(({ age }) => age === null || age > maxAge);

  if (stale.length) {
    console.log(`\n${stale.length} claim(s) not re-read in ${maxAge} days:`);
    for (const { claim, age } of stale) {
      console.log(`  ${claim.id.padEnd(28)} ${age === null ? 'never recorded' : `${age} days`}`);
    }
    console.log('\nStaleness is not an error — evidence can stand for years. It is a prompt');
    console.log('to re-read, because nothing here can detect a finding being overturned.');
  }

  if (noPmid.length) {
    console.log(`\n${noPmid.length} claim(s) cite something other than PubMed and cannot be audited:`);
    for (const { claim } of noPmid) console.log(`  ${claim.id}  ${claim.source}`);
  }

  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`claim audit failed: ${err.message}`);
  process.exitCode = 2;
});
