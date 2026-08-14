---
description: Show smart-thinking state — cache age, providers, and what's live in settings.json
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/setup.js" status
```

Show the output. If the cache is empty or older than the configured `contentMaxAgeMinutes`, mention that `/thinking-refresh` will force an update.

If any provider is off, say briefly what it needs to be turned on (weather: coordinates; news: at least one feed).

If the recent refresh log has errors, surface them:

```bash
tail -20 ~/.claude/smart-thinking/refresh.log
```
