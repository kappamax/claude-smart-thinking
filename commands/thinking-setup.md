---
description: Configure smart-thinking providers (weather location, curated feed bundles, learning deck)
---

Configure the smart-thinking plugin for this user.

The config file is `~/.claude/smart-thinking/config.json`. Read it first (it may not exist yet — defaults live in `${CLAUDE_PLUGIN_ROOT}/lib/config.js`).

Ask only for what is missing, then write the config.

## 1. Sources — lead with the curated catalog, not a blank prompt

Read `${CLAUDE_PLUGIN_ROOT}/data/feeds.catalog.json`. It holds seven bundles, every feed in it verified against this plugin's own parser.

Show the user the bundle labels and their one-line `why`, and ask which they want. Do **not** just ask "which feeds do you follow?" — the point of the catalog is that it has taste built in, and most people's honest answer is a handful of sites they'd have found anyway.

The catalog's own principle is worth repeating to them if they ask why their usual tech site isn't in it: this surface gets a few seconds of involuntary attention, so anything they'd encounter through normal channels is wasted width.

When they pick bundles, copy those feed entries verbatim into `providers.news.feeds` — including the `mode` field, which matters:

- `recent` — newest items, age-filtered. For outlets genuinely publishing news.
- `evergreen` — sampled from anywhere in the archive, ignoring age. For writers whose old posts are as good as their new ones. Several catalog feeds carry 100–200 item archives.

Set `providers.news.enabled` to true once at least one feed is present. They can of course add their own feeds too — just ask whether each is `recent` or `evergreen`.

## 2. Weather

Needs `latitude`, `longitude`, and `leaveForWorkAt` (24h `HH:MM`). Ask for their city and convert it to coordinates yourself; don't make them look it up. Set `providers.weather.enabled` true once coordinates are set. Uses Open-Meteo, so no API key.

## 3. Wellness

On by default. Worth confirming two values:

- `wakeTime` — used late at night to report the concrete trade ("5.5h until 07:00 — sleeping now gets you 3 complete cycles").
- `lateNightStartHour` — when sleep content starts appearing, default 22.

## 4. Fresh news — offer it, and state the cost

Ask whether they want new cards harvested from their feeds automatically. **Do not enable it silently**, and do not skip the caveat:

> Fresh cards come from a scheduled Claude Code session that reads the articles and writes cards. On a subscription this draws on your plan usage — the same five-hour and seven-day windows your status line shows — rather than API credits, so there is no separate bill. A run is small: a few articles is a few thousand tokens of reading plus a short write. The reason it is opt-in is that it starts an autonomous session that edits your deck.

The reason it works this way is worth explaining if they ask: surfacing feed *titles* directly was tried and removed, because a headline states no mechanism and nothing to do — recommending something nobody read. Reading the article is the whole value, and that needs a model, so it happens on a schedule instead of at render time.

If they want it:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/harvest.sh" install <bundle>
```

Default is daily at 07:00 so something new is waiting at the start of the day. Pass a cron expression as the third argument to change it, and confirm the bundle with them first — `indie`, `deep-eng`, `science`, `history-culture`, `ideas`, `how-things-work`, `curious`. Show them the installed line, and mention `harvest.sh status` and `harvest.sh uninstall`.

If they decline, say the commands are still there on demand: `/smart-thinking:thinking-digest` and `/smart-thinking:thinking-research`.

## 5. Learning deck

On by default with the bundled 185-card deck. Offer to copy `${CLAUDE_PLUGIN_ROOT}/data/deck.sample.json` to `~/.claude/smart-thinking/deck.json` so they can edit it, and mention `/thinking-deck <topic>` for generating more.

## Finally

Write the config with Edit/Write, preserving keys already there, and run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/setup.js" refresh
```

Report what got enabled and show the resulting status output.
