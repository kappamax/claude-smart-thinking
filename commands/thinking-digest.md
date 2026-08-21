---
description: Read the curated feeds and turn what's actually in the articles into teaching cards
---

Turn recent reading into deck cards. News is good material and bad tips, so the reading happens here, once, rather than at render time.

$ARGUMENTS

## Why this exists

The news provider surfaced feed titles directly and was removed. A headline is written to be clicked, not to teach: `TrueForge – The open-source agent harness` states no mechanism, no finding, and nothing to do — and putting it in a teaching slot recommends something nobody read. That is the accurate criticism of it.

The material was never the problem. Follow the link, read the piece, and there is often something genuinely worth knowing in it. That step needs judgement, so it belongs in a command.

## 1. Read

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/digest.js" --bundle deep-eng --limit 3
node "${CLAUDE_PLUGIN_ROOT}/bin/digest.js" --feed https://jvns.ca/atom.xml --limit 2
```

Bundles come from `data/feeds.catalog.json`: `indie`, `deep-eng`, `science`, `history-culture`, `ideas`, `how-things-work`, `curious`. The tool prints the article body, not the title. Plenty of publishers block automated clients — when the body is missing it says so, and you should open the link yourself rather than writing a card from a headline.

## 2. Find the teachable thing

Most articles contain none. That is the expected outcome and rejecting them is the job.

What qualifies:

- **A mechanism you could explain to someone else.** How something actually works, not that it exists.
- **A correction.** The piece shows a widely-held belief is wrong.
- **A technique with a story.** Something a reader could apply tomorrow.

What does not:

- A product announcement, however interesting the product.
- A trend, a funding round, an opinion, a roundup.
- Anything where the card would just be the headline reworded.

## 3. Write the card

Append to `~/.claude/smart-thinking/deck.json` (or `data/deck.sample.json` when improving the shipped deck):

```json
{
  "id": "unique-slug",
  "tag": "Postgres",
  "text": "The mechanism, specific enough to be checkable.",
  "action": "What to do differently.",
  "url": "https://the-article-you-actually-read/",
  "sourceType": "primary"
}
```

`sourceType` is `primary` when the article is the authoritative account — an author explaining their own system, an official postmortem, a specification. Use `peer-reviewed` only if you followed it to the paper and are citing that instead. Never `reference` for something new; that tier exists for cards awaiting re-sourcing, not for cards being added.

Everything the deck rules require still applies: teach a mechanism rather than a fact, carry your own context, end with what to do, and no action that restates its own card.

## 4. Verify

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/checklinks.js" ~/.claude/smart-thinking/deck.json
node --test
```

Then report what you read and what you rejected. Five articles yielding one card is a good session.
