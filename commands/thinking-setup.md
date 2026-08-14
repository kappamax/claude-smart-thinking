---
description: Configure smart-thinking providers (weather location, news feeds, learning deck)
---

Configure the smart-thinking plugin for this user.

The config file is `~/.claude/smart-thinking/config.json`. Read it first (it may not exist yet — defaults live in `${CLAUDE_PLUGIN_ROOT}/lib/config.js`).

Ask the user only for what is missing, then write the config:

1. **Weather** — needs `latitude`, `longitude`, and `leaveForWorkAt` (24h `HH:MM`). Ask for their city and convert it to coordinates yourself; don't make them look it up. Set `providers.weather.enabled` to true once coordinates are set. Uses Open-Meteo, so no API key.
2. **News** — needs `providers.news.feeds`, a list of RSS/Atom URLs or `{url, label}` objects. Ask which sources they actually follow. Set `enabled` true once at least one feed is present.
3. **Learning** — on by default using the starter deck. Offer to copy `${CLAUDE_PLUGIN_ROOT}/data/deck.sample.json` to `~/.claude/smart-thinking/deck.json` so they can edit it.

Write the config with the Edit/Write tools, preserving any keys already there.

Then run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/setup.js" refresh
```

Report what got enabled and show the resulting status output.
