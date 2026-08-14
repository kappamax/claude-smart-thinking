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

## 4. Learning deck

On by default with the bundled 185-card deck. Offer to copy `${CLAUDE_PLUGIN_ROOT}/data/deck.sample.json` to `~/.claude/smart-thinking/deck.json` so they can edit it, and mention `/thinking-deck <topic>` for generating more.

## Then

Write the config with Edit/Write, preserving keys already there, and run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/setup.js" refresh
```

Report what got enabled and show the resulting status output.
