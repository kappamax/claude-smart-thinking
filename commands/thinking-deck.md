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

- **One useful line plus one link.** The line has to pay for itself on its own; the link is how the reader goes deeper. A fact with no way to follow up is trivia.
- **The link must actually resolve.** Prefer a stable canonical source — Wikipedia, official docs, a standards body — over a blog post or a search URL. Never invent a plausible-looking URL.
- **One fact per card.** If it needs an "and also", split it.
- **Specific and falsifiable.** "Indexes speed up reads" teaches nothing; "a composite index on (a, b) can't serve a query filtering on b alone" does.
- **Unique `id`** — exposure tracking is keyed on it, so reusing an id inherits the old card's history.
- **Go wide.** The deck is not a work feed. Biology, history, travel, physics, statistics, economics, cooking, health, language, art, philosophy all belong alongside engineering.

$ARGUMENTS

If the user named a topic, generate 10–20 cards on it and merge them into the deck, keeping existing cards. If they passed nothing, ask what topic they want — and suggest a domain they don't already have cards in.

After writing, **verify the links before claiming it worked**:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/checklinks.js" ~/.claude/smart-thinking/deck.json
```

Fix or drop anything that fails, re-run until clean, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.js" refresh` and report the new card count.
