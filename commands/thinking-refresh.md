---
description: Force an immediate smart-thinking content refresh
---

Run a synchronous refresh and report the result:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/setup.js" refresh
```

This refetches every enabled provider, rewrites `spinnerTipsOverride` and `spinnerVerbs` in `~/.claude/settings.json`, and updates the status line cache.

Note for the user: Claude Code caches settings in-process. New tips are picked up when the settings watcher notices the change; if they don't appear, opening `/config` or starting a new session will definitely reload them.
