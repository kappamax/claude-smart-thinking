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
#
# Weekly, via crontab -e:
#   0 7 * * 1 cd /path/to/claude-smart-thinking && bin/harvest.sh digest curious >> ~/.claude/smart-thinking/harvest.log 2>&1
#
set -euo pipefail

MODE="${1:-digest}"
ARG="${2:-}"
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
    echo "usage: bin/harvest.sh {digest <bundle>|research <topic>}" >&2; exit 2
    ;;
esac

echo "=== $(date -u +%FT%TZ) harvest $MODE ${ARG} ==="

# --permission-mode acceptEdits so it can write the deck without a prompt, but
# it is still confined to the commands above rather than given a free brief.
claude -p "$PROMPT" --permission-mode acceptEdits
