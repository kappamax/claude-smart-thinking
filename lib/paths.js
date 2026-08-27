'use strict';

const os = require('os');
const path = require('path');

// Everything user-owned lives outside the plugin directory on purpose.
// ${CLAUDE_PLUGIN_ROOT} is versioned and gets garbage-collected ~2 weeks
// after an update, so no state may live there.
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// Other hosts can provide their own state root without pretending to be a
// Claude installation. OpenCode's adapter uses this and never touches either
// application's settings file.
const STATE_DIR = process.env.SMART_THINKING_HOME || path.join(CLAUDE_DIR, 'smart-thinking');

module.exports = {
  CLAUDE_DIR,
  STATE_DIR,
  settingsFile: path.join(CLAUDE_DIR, 'settings.json'),
  settingsBackup: path.join(STATE_DIR, 'settings.backup.json'),
  configFile: path.join(STATE_DIR, 'config.json'),
  cacheFile: path.join(STATE_DIR, 'cache.json'),
  deckFile: path.join(STATE_DIR, 'deck.json'),
  logFile: path.join(STATE_DIR, 'refresh.log'),
  lockFile: path.join(STATE_DIR, 'refresh.lock'),
};
