---
description: Remove everything smart-thinking wrote to settings.json and restore the previous status line
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/setup.js" off
```

This deletes `spinnerTipsOverride`, `spinnerVerbs`, and `spinnerTipsEnabled` from `~/.claude/settings.json`, and restores whatever status line was configured before the plugin was installed.

Confirm to the user that a pre-install backup remains at `~/.claude/smart-thinking/settings.backup.json`, and that disabling the plugin in `/plugin` stops the SessionStart hook from reinstalling the status line.
