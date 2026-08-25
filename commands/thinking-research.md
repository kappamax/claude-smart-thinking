---
description: Research a topic in the peer-reviewed literature and add graded claims to the health corpus
---

Add evidence-graded claims to `data/wellness.evidence.json` (or the user's copy at `~/.claude/smart-thinking/`) by actually reading the literature.

$ARGUMENTS

## Why this is a command and not a provider

Two attempts were made to surface literature automatically at render time, and both failed the same way: **a paper title is not a finding.** Cochrane titles are deliberately non-committal — "Physical activity for the management of obesity in adolescents aged 10 to 19 years" — because the conclusion lives in the abstract. Filtering by journal removed the junk and still left titles nobody can learn from.

The judgement has to happen once, by someone reading. That is this command.

## 1. Gather candidates

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/research.js" "<topic>" --count 6
```

It returns review-level work from journals whose output is broadly consequential, **with abstracts**. If the curated journal set returns nothing on PubMed, it automatically falls back to Europe PMC — a separate index that still only surfaces candidates with a resolvable PubMed or PMC link. Add `--any-journal` if that still comes up empty, to widen the PubMed search itself, and judge quality yourself when you do.

## 2. Read the abstracts and decide what is worth saying

This is the part no script can do. For each candidate, ask:

- **What did it actually find?** A number, a direction, a magnitude. "Interventions reduced overall burnout from 54% to 44%" is a finding. "Interventions were studied" is not.
- **Does it change what someone would do?** If not, skip it — however good the journal.
- **Is it surprising, or does it correct something widely believed?** Those are the highest-value entries. A claim that removes a false belief beats one that adds a true fact.
- **What does it not show?** Effect sizes are often smaller than the abstract's framing implies, and a claim's limits belong in the claim.

Reject freely. Six candidates producing one good entry is a normal result.

## 3. Write the entry

```json
{
  "id": "topic-short-slug",
  "topic": "Sleep",
  "evidence": "meta-analysis",
  "text": "The finding, in one sentence, specific enough to be checkable.",
  "action": "What to do differently. Omit only if genuinely nothing follows.",
  "source": "https://pubmed.ncbi.nlm.nih.gov/PMID/",
  "verified": "YYYY-MM-DD"
}
```

Rules the tests enforce:

- `evidence` must be one of the tiers declared at the top of the corpus file. `umbrella-review` outranks `meta-analysis`, which outranks `RCT`, then `cohort`. Use `contested` when the literature genuinely disputes it — and then **the text must say so**, because a disputed finding stated flatly is the failure this corpus exists to prevent.
- `source` must be PubMed or NCBI. Publisher links return 403 to any automated client, so they cannot be verified.
- `action` is required. A claim with no consequence is trivia.
- **Never render the tier in the text.** Evidence selects the claim; it is not part of the claim. The tier weights how often it surfaces.

Prefer a claim that undercuts a popular belief, and say the quiet part: if the effect is real but smaller than advertised, that is the claim.

## 4. Verify before saying it worked

```bash
node --test                                          # schema and tier gates
node "${CLAUDE_PLUGIN_ROOT}/bin/checkclaims.js"      # retractions + resolvable sources
```

Report which candidates you rejected and why. That reasoning is the most useful part of the output — it is the record of what was considered and found wanting.
