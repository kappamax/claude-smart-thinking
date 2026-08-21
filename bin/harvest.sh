#!/usr/bin/env bash
#
# Close the freshness loop.
#
# The plugin's teaching content is static: a deck file and an evidence corpus.
# Two attempts to make it live at render time both failed for the same reason —
# a title is not a finding, and nothing in a background Node process can read an
# article and decide what is worth teaching.
#
# What can do that is Claude Code itself. So the judgement is not automated; its
# *invocation* is. This runs the same command a person would type, headless, on
# whatever schedule you choose. New cards arrive without anyone remembering to
# ask, and every card still went through a reading step.
#
# Cost, accurately: on a Claude Code subscription this consumes plan usage — the
# same five-hour and seven-day rate-limit windows a status line reports — not
# API credits, and not an incremental bill. On an API key it bills per token.
# Either way a run is small: three articles is a few thousand tokens of reading
# plus a short write. The reason it is off by default is that it starts an
# autonomous session that edits your deck, which should be a deliberate choice
# rather than a surprise.
#
#   bin/harvest.sh digest deep-eng
#   bin/harvest.sh research "sleep architecture"
#   bin/harvest.sh install curious "0 7 * * *"   # daily at 07:00
#   bin/harvest.sh status | uninstall
#
# Daily at 07:00, so there is something new waiting at the start of the day:
#   bin/harvest.sh install curious
#
set -euo pipefail

MODE="${1:-digest}"
ARG="${2:-}"
if [ "$MODE" = "digest" ] && [ -z "$ARG" ]; then ARG="curious"; fi

# ---------------------------------------------------------------------------
# install / uninstall the schedule
#
# Editing someone's crontab is invasive, so this is explicit, idempotent, and
# never touches a line it did not write. Every entry it manages carries the
# marker below so uninstall can find exactly its own and nothing else.
# ---------------------------------------------------------------------------
MARKER="# smart-thinking-harvest"

if [ "$MODE" = "install" ]; then
  BUNDLE="${ARG:-curious}"
  SCHED="${3:-0 7 * * *}"
  # The cron line deliberately references no plugin path.
  #
  # An earlier version ran "cd <plugin dir> && bin/harvest.sh", which works
  # until the next update: ${CLAUDE_PLUGIN_ROOT} is version-stamped and reaped
  # a couple of weeks later, so the cron would fail silently and the only
  # symptom would be a deck that stopped growing. Invoking the slash command
  # directly lets Claude Code resolve it from whatever version is installed.
  PROMPT_TEXT="/thinking-digest $BUNDLE. Read the articles, write at most two cards into ~/.claude/smart-thinking/deck.json, and reject anything that would only restate a headline. Verify links before finishing."
  LOGFILE="$HOME/.claude/smart-thinking/harvest.log"
  LINE="$SCHED cd \$HOME && claude -p '$PROMPT_TEXT' --permission-mode acceptEdits < /dev/null >> $LOGFILE 2>&1 $MARKER"
  EXISTING="$(crontab -l 2>/dev/null || true)"
  if printf '%s\n' "$EXISTING" | grep -qF "$MARKER"; then
    echo "Replacing the existing smart-thinking schedule."
    EXISTING="$(printf '%s\n' "$EXISTING" | grep -vF "$MARKER")"
  fi
  printf '%s\n%s\n' "$EXISTING" "$LINE" | grep -v '^$' | crontab -
  echo "Installed:"
  echo "  $LINE"
  echo
  echo "Remove it with: bin/harvest.sh uninstall"
  exit 0
fi

if [ "$MODE" = "uninstall" ]; then
  EXISTING="$(crontab -l 2>/dev/null || true)"
  if ! printf '%s\n' "$EXISTING" | grep -qF "$MARKER"; then
    echo "No smart-thinking schedule installed."
    exit 0
  fi
  printf '%s\n' "$EXISTING" | grep -vF "$MARKER" | grep -v '^$' | crontab -
  echo "Removed the smart-thinking schedule. Nothing else in your crontab was touched."
  exit 0
fi

if [ "$MODE" = "status" ]; then
  if crontab -l 2>/dev/null | grep -F "$MARKER"; then :; else echo "No smart-thinking schedule installed."; fi
  exit 0
fi
LOG="${HOME}/.claude/smart-thinking/harvest.log"
mkdir -p "$(dirname "$LOG")"

case "$MODE" in
  digest)
    PROMPT="/thinking-digest ${ARG:-curious}. Read the articles, write at most two cards into ~/.claude/smart-thinking/deck.json, and reject anything that would only restate a headline. Verify links before finishing. Report what you rejected and why."
    ;;
  research)
    if [ -z "$ARG" ]; then echo "research needs a topic: bin/harvest.sh research \"burnout\"" >&2; exit 2; fi
    PROMPT="/thinking-research ${ARG}. Add at most two claims to the health corpus. Reject anything whose finding you cannot state in one sentence. Run the tests and the claim audit before finishing."
    ;;
  *)
    echo "usage: bin/harvest.sh {digest <bundle>|research <topic>|install [bundle] [cron]|uninstall|status}" >&2; exit 2
    ;;
esac

echo "=== $(date -u +%FT%TZ) harvest $MODE ${ARG} ==="

# --permission-mode acceptEdits so it can write the deck without a prompt, but
# it is still confined to the commands above rather than given a free brief.
claude -p "$PROMPT" --permission-mode acceptEdits < /dev/null
