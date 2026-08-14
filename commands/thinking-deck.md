---
description: Add cards to the smart-thinking learning deck, or generate a deck on a topic
---

Manage the user's learning deck at `~/.claude/smart-thinking/deck.json`.

If that file doesn't exist, seed it from `${CLAUDE_PLUGIN_ROOT}/data/deck.sample.json`.

Deck format — `url` is required, not optional:

```json
{ "cards": [ { "id": "unique-slug", "tag": "Biology", "text": "One line.", "url": "https://…" } ] }
```

Rules for good cards, since they render in a narrow single-line spinner slot:

- **A nugget, not a manual entry.** This is the single most important rule. "A composite index on (a, b) can't serve a query filtering on b alone" is line 10 of the Postgres manual — the reader can look it up the moment they need it, and won't remember it now. "Knuth pays $2.56 for each error found in his books — one hexadecimal dollar" is something they'll repeat to someone. Aim for the second. If a card reads like reference documentation, cut it.
- **The test: would you say this out loud at dinner?** Surprise, a name, a person, a story, or a number that doesn't sound real. Techniques qualify when they have a story ("the strangler fig grows around a tree and outlives it"); API details don't.
- **One useful line plus one link.** The line has to pay for itself on its own; the link is how the reader goes deeper. A fact with no way to follow up is trivia.
- **The link must actually resolve.** Prefer a stable canonical source — Wikipedia, official docs, a standards body — over a blog post or a search URL. Never invent a plausible-looking URL.
- **One fact per card.** If it needs an "and also", split it.
- **Specific and falsifiable.** Vague gestures teach nothing. "Sleep helps memory" is worthless; "slow-wave sleep replays the day's hippocampal traces into cortex, so studying without sleeping largely wastes the study" is a claim someone could check.
- **Unique `id`** — exposure tracking is keyed on it, so reusing an id inherits the old card's history.
- **Go wide.** The deck is not a work feed. Biology, history, travel, physics, statistics, economics, cooking, health, language, art, philosophy all belong alongside engineering.

$ARGUMENTS

If the user named a topic, generate 10–20 cards on it and merge them into the deck, keeping existing cards. If they passed nothing, ask what topic they want — and suggest a domain they don't already have cards in.

After writing, **verify the links before claiming it worked**:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/checklinks.js" ~/.claude/smart-thinking/deck.json
```

Fix or drop anything that fails, re-run until clean, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.js" refresh` and report the new card count.
