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
# Plugin-provided slash commands resolve under the plugin's namespace, e.g.
# /smart-thinking:thinking-digest — the un-namespaced command name alone is
# silently rejected by `claude -p` (see the exit-code note below), so a
# scheduled harvest built with the wrong prefix fails every run with nothing
# to show for it. Derive the prefix from plugin.json instead of hardcoding it,
# so a future plugin rename doesn't reintroduce this bug; SMART_THINKING_CMD_PREFIX
# overrides it if needed.
# ---------------------------------------------------------------------------
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -n "${SMART_THINKING_CMD_PREFIX:-}" ]; then
  CMD_PREFIX="$SMART_THINKING_CMD_PREFIX"
else
  # Parse structurally rather than grepping for the first "name" match, which
  # would silently match the nested author.name field if plugin.json's keys
  # were ever reordered (e.g. by a key-sorting formatter).
  CMD_PREFIX="$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).name' "$PLUGIN_ROOT/.claude-plugin/plugin.json" 2>/dev/null)"
fi
if [ -z "$CMD_PREFIX" ]; then
  echo "Could not determine plugin command prefix from $PLUGIN_ROOT/.claude-plugin/plugin.json" >&2
  exit 2
fi

# Reading a few articles and writing at most two cards doesn't need the
# default model's full reasoning depth — Haiku is faster and cheaper for this
# job. `research` keeps the full default model instead: grading evidence
# tiers and running the claim audit is closer to the judgment the interactive
# research command assumes than digest's simpler "worth a card or not" call.
# SMART_THINKING_MODEL overrides either.
if [ -n "${SMART_THINKING_MODEL:-}" ]; then
  MODEL="$SMART_THINKING_MODEL"
elif [ "$MODE" = "research" ]; then
  MODEL=""
else
  MODEL="haiku"
fi

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
  PROMPT_TEXT="/$CMD_PREFIX:thinking-digest $BUNDLE. Read the articles, write at most two cards into ~/.claude/smart-thinking/deck.json, and reject anything that would only restate a headline. Verify links before finishing."
  LOGFILE="$HOME/.claude/smart-thinking/harvest.log"
  MODEL_FLAG=""
  if [ -n "$MODEL" ]; then MODEL_FLAG="--model $MODEL"; fi
  LINE="$SCHED cd \$HOME && claude -p '$PROMPT_TEXT' $MODEL_FLAG --permission-mode acceptEdits < /dev/null >> $LOGFILE 2>&1 $MARKER"
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
    PROMPT="/$CMD_PREFIX:thinking-digest ${ARG:-curious}. Read the articles, write at most two cards into ~/.claude/smart-thinking/deck.json, and reject anything that would only restate a headline. Verify links before finishing. Report what you rejected and why."
    ;;
  research)
    if [ -z "$ARG" ]; then echo "research needs a topic: bin/harvest.sh research \"burnout\"" >&2; exit 2; fi
    PROMPT="/$CMD_PREFIX:thinking-research ${ARG}. Add at most two claims to the health corpus. Reject anything whose finding you cannot state in one sentence. Run the tests and the claim audit before finishing."
    ;;
  *)
    echo "usage: bin/harvest.sh {digest <bundle>|research <topic>|install [bundle] [cron]|uninstall|status}" >&2; exit 2
    ;;
esac

echo "=== $(date -u +%FT%TZ) harvest $MODE ${ARG} ==="

# --permission-mode acceptEdits so it can write the deck without a prompt, but
# it is still confined to the commands above rather than given a free brief.
#
# `claude -p` exits 0 even when the slash command is unrecognized, so a
# broken invocation looks identical to a run that legitimately found nothing
# worth a card. Check the output itself rather than trusting the exit code.
STATUS=0
# Bash 3.2 (macOS's stock /bin/bash) throws "unbound variable" on
# "${arr[@]}" for an empty array under `set -u`, so branch on two full
# commands rather than building a conditional args array.
if [ -n "$MODEL" ]; then
  OUTPUT="$(claude -p "$PROMPT" --model "$MODEL" --permission-mode acceptEdits < /dev/null 2>&1)" || STATUS=$?
else
  OUTPUT="$(claude -p "$PROMPT" --permission-mode acceptEdits < /dev/null 2>&1)" || STATUS=$?
fi
printf '%s\n' "$OUTPUT"
if [ $STATUS -ne 0 ]; then
  exit $STATUS
fi
if printf '%s\n' "$OUTPUT" | grep -qE '^Unknown command:'; then
  echo "harvest.sh: '$PROMPT' was not recognized as a slash command (prefix '$CMD_PREFIX') — no cards were written." >&2
  exit 1
fi
