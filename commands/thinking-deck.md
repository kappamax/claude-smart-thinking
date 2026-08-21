---
description: Add cards to the smart-thinking learning deck, or generate a deck on a topic
---

Manage the user's learning deck at `~/.claude/smart-thinking/deck.json`.

If that file doesn't exist, seed it from `${CLAUDE_PLUGIN_ROOT}/data/deck.sample.json`.

Deck format — `url` is required; `action` is required for anything practical:

```json
{ "cards": [ {
  "id": "unique-slug", "tag": "Bread",
  "text": "The mechanism — what is actually happening.",
  "action": "What to do differently tomorrow.",
  "url": "https://…"
} ] }
```

Rules for good cards, since they render in a narrow single-line spinner slot:

- **Carry your own context.** Write for someone meeting this cold, mid-task, with no setup. "Abraham Wald argued for armouring where returning bombers had no bullet holes" is unreadable unless you already know the story — it names the person and jumps to the conclusion without ever stating the problem. Give the situation, then the insight. A card that needs a Wikipedia trip to parse has failed before the link is clicked.
- **End with what to do.** A card that explains starch retrogradation and stops has told the reader something true and left them holding it. "Freeze what you won't eat in two days, never refrigerate" is the part that changes tomorrow. Put the mechanism in `text` and the instruction in `action`; don't restate one in the other. Omit `action` only where there genuinely isn't one — Knuth's reward cheques are worth knowing and nothing follows from them.
- **Never use an acronym you have not defined.** Spell it out, then put the acronym in brackets. "CRDTs are built so concurrent edits merge…" assumes the reader already knows, which defeats the point of a teaching surface; "Conflict-free replicated data types (CRDTs) are built so…" costs four words and loses nobody. Proper names and literal identifiers are exempt — MIX is a fictional machine, `HEAD` is a git ref you type verbatim — and a test enforces the rest.
- **Say whether the card ages.** `lifespan: "timeless"` for anything that will read the same in ten years, which is most of the deck. `lifespan: "timely"` plus a `createdAt` for anything tied to a moment: it surfaces strongly while fresh, fades across its lifetime, and retires rather than quietly becoming wrong. `bin/prune.js` reports the retired ones so a reset is a decision, not a side effect.
- **Teach a mechanism, not a fact.** The highest bar. "Cleopatra lived closer to the Moon landing than to the Great Pyramid" is inert — nobody is different for knowing it. "Flour contains no gluten; glutenin and gliadin only link once hydrated, and kneading aligns them into sheets that trap gas" changes how someone bakes. Prefer systems the reader actually touches: bread, coffee, sleep, their own tools.
- **Health claims must cite primary research.** Not Wikipedia, not a magazine. A systematic review or meta-analysis beats an RCT, which beats a cohort study. Name the study design in the card and link PubMed. If the finding is disputed, say so in the text — the corpus in `data/wellness.evidence.json` is the model, and `contested` is a valid, useful tier.
- **Correcting a myth is high value.** "Microwaves hit water's resonant frequency" and "pressure melts ice under a skate" are both wrong and both widely believed. Replacing a false model beats adding a true fact.
- **A nugget, not a manual entry.** This is the single most important rule. "A composite index on (a, b) can't serve a query filtering on b alone" is line 10 of the Postgres manual — the reader can look it up the moment they need it, and won't remember it now. "Knuth pays $2.56 for each error found in his books — one hexadecimal dollar" is something they'll repeat to someone. Aim for the second. If a card reads like reference documentation, cut it.
- **The test: would you say this out loud at dinner?** Surprise, a name, a person, a story, or a number that doesn't sound real. Techniques qualify when they have a story ("the strangler fig grows around a tree and outlives it"); API details don't.
- **One useful line plus one link.** The line has to pay for itself on its own; the link is how the reader goes deeper. A fact with no way to follow up is trivia.
- **The link must actually resolve.** Prefer a stable canonical source — Wikipedia, official docs, a standards body — over a blog post or a search URL. Never invent a plausible-looking URL.
- **One fact per card.** If it needs an "and also", split it.
- **Specific and falsifiable.** Vague gestures teach nothing. "Sleep helps memory" is worthless; "slow-wave sleep replays the day's hippocampal traces into cortex, so studying without sleeping largely wastes the study" is a claim someone could check.
- **Unique `id`** — exposure tracking is keyed on it, so reusing an id inherits the old card's history.
- **Go wide, but not into trivia.** Chemistry, medicine, technique, craft, and economics all belong alongside engineering. Isolated dates, records, and "closer in time than you think" comparisons do not — breadth means more kinds of understanding, not more facts.

$ARGUMENTS

If the user named a topic, generate 10–20 cards on it and merge them into the deck, keeping existing cards. If they passed nothing, ask what topic they want — and suggest a domain they don't already have cards in.

After writing, **verify the links before claiming it worked**:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/checklinks.js" ~/.claude/smart-thinking/deck.json
```

Fix or drop anything that fails, re-run until clean, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.js" refresh` and report the new card count.
