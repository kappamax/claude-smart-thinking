# smart-thinking

Replaces Claude Code's idle spinner text, or OpenCode's busy-state toast, with content worth reading.

The time you spend watching *"Doodling…"* is captive attention. This plugin fills it with a wide learning deck, the weather in the hour before you leave, headlines from feeds you actually follow, and the state of the repo you're sitting in — all of it linked, so anything interesting has somewhere to go next.

```
Opus 5 | master | claude_smart_thinking | 73% left | 5h: 12%
Leaving in 25m · 76°F overcast (feels 83°F)

✻ Untangling… Biology — CRISPR is a bacterial immune system: bacteria file away
  snippets of virus DNA to recognize repeat attackers. Gene editing is us
  borrowing the filing system. → https://en.wikipedia.org/wiki/CRISPR
```

**One useful line, plus a link to go deeper.** A fact with no path to follow up is trivia. Every card and every headline carries a URL, and `bin/checklinks.js` verifies they resolve — a plausible-looking link that 404s spends the reader's click and their trust. Every link is verified by `bin/checklinks.js`, and `bin/checkclaims.js` audits the health corpus against PubMed for retractions.

## What's actually overridable

Claude Code exposes three surfaces. Verified against the Zod schema and tip loader compiled into **v2.1.252** — the published settings docs describe the first two as plain string arrays, which is stale and rejected by the schema.

| Setting | What it controls | Dynamic? |
|---|---|---|
| `spinnerVerbs` | the verb — "Doodling", "Puzzling" | Static list, rotated |
| `spinnerTipsOverride` | the tip beside the spinner | **Static strings** — no callback |
| `statusLine` | script-driven bar, multi-line | **Yes** — `refreshInterval` re-runs it every N seconds |

```jsonc
spinnerTipsEnabled:  boolean
spinnerVerbs:        { mode: "append"|"replace", verbs: string[] }
spinnerTipsOverride: { excludeDefault?: boolean, label?: string, tipsFile?: string,
                       tips: (string | {id, text, cooldownSessions?, priority?})[] }
statusLine:          { type:"command", command, padding?, refreshInterval? }
```

Internally a tip is `{id, content: async () => …, isRelevant, cooldownSessions}` — both `content` and `isRelevant` *are* callbacks, but user-supplied tips get wrapped as `async () => "<your literal string>"` and `async () => true`. Neither dynamism nor relevance is reachable from settings, so this plugin computes both itself at refresh time and expresses them through *which* strings it supplies.

So this plugin uses both surfaces for what each is good at:

- **Tips** get the attention but not the freshness → refreshed by rewriting `settings.json` out-of-band.
- **Status line** gets the freshness → genuinely re-executed on a timer, so anything time-sensitive lives there.

### Tips are sanitized; the status line is not

A tip is not passed through to the renderer. Every one goes through this first:

```js
Bun.stripANSI(text)                          // SGR colour, gone
  .replace(/[\t\n\r\u2028\u2029]+/g, ' ')
  .replace(/[\p{Cc}\p{Cf}…]/gu, '')          // ESC itself, gone → OSC 8 gone
  .replace(/ {2,}/g, ' ').trim()
```

then the tip is dropped entirely if it is empty or longer than **500 characters** (and only the first 200 tips are read at all).

Colour is the smaller loss. An OSC 8 hyperlink carries its URL *inside* the escape, so a link-styled tip came out as plain text with a dangling `↗` and no destination at all — the reader lost the follow-up, not just the styling. So tips are built plain, with the URL visible as text, and terminals linkify that themselves. Anything over 500 characters is skipped at deal time so the next pool item takes the slot rather than the slot going silently empty.

Status line output is *not* sanitized, so colour, the category index and OSC 8 links still work there.


`excludeDefault: true` makes Claude Code serve *only* your tips, which also suppresses built-in tips and marketplace plugin-advertisement tips.

## Architecture

```
SessionStart hook ──► re-points statusLine at the current plugin dir
                 └──► spawns a detached refresh

statusline.js (hot path, every render + every refreshInterval)
    ├── runs your previous status line, output becomes line 1
    ├── prints one status item from cache          ← never blocks
    └── if cache is stale, spawns a detached refresh

refresh.js (background)
    ├── detects context: git state + stack from manifests   ← lib/context.js
    ├── runs enabled providers concurrently, failures isolated
    ├── round-robins sources so one feed can't crowd out the deck
    ├── writes cache.json
    └── rewrites spinnerTipsOverride + spinnerVerbs in settings.json
```

Three deliberate choices:

**Monitors are not used.** Plugin monitors pipe stdout to Claude as *notifications*, so every weather update would consume context tokens. This surface should cost pixels, not tokens.

**`${CLAUDE_PLUGIN_ROOT}` is never persisted as state.** It's version-stamped and garbage-collected roughly two weeks after an update, so the absolute path baked into `statusLine.command` goes stale on every upgrade. The SessionStart hook rewrites it each session, which makes updates self-healing. All state lives in `~/.claude/smart-thinking/`.

**Your existing status line is wrapped, not replaced.** Whatever was configured before install is captured to `config.json` and rendered as line 1, and handed back on uninstall.

## Install

### Claude Code

```bash
/plugin marketplace add kappamax/claude-smart-thinking   # or a local path
/plugin install smart-thinking@kappamax
/thinking-setup
```

`/thinking-setup` asks for a city (converted to coordinates for you), your leave-for-work time, and which feeds you follow. Learning works with no configuration.

### OpenCode

OpenCode does not expose its spinner text or a custom status-line hook. The native adapter therefore uses bounded-duration TUI toasts while a session is busy. It consumes no model context, stops its timer when the session becomes idle, and writes only under `~/.config/opencode/smart-thinking/`.

Clone this repository somewhere stable, then add the adapter to `~/.config/opencode/opencode.json` (or `.jsonc`). Use an absolute `file://` URL:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "file:///Users/you/workspace/claude-smart-thinking/opencode/smart-thinking.ts",
      {
        "rotationSeconds": 90,
        "toastDurationMs": 12000
      }
    ]
  ]
}
```

Quit and restart OpenCode after changing its config; plugins are loaded only at startup. The bundled learning deck works immediately. Optional configuration uses the same shape documented below, at `~/.config/opencode/smart-thinking/config.json`.

To share an existing deck or configuration with Claude Code, point `stateDir` at it explicitly:

```json
[
  "file:///Users/you/workspace/claude-smart-thinking/opencode/smart-thinking.ts",
  { "stateDir": "~/.claude/smart-thinking" }
]
```

The adapter starts the existing provider refresh in the background with `--no-settings`, so even a shared state directory does not modify Claude Code's `settings.json`. OpenCode toasts include the source URL as visible text; the TUI toast API does not currently expose clickable link labels.

## Packaging and distribution

This repo is both the plugin and the marketplace that serves it — `.claude-plugin/` holds `plugin.json` and `marketplace.json` side by side, and the entry uses `"source": "./"` (the marketplace-root layout).

```
.claude-plugin/
  plugin.json        ← the plugin manifest
  marketplace.json   ← the catalog; one entry, source "./"
bin/  lib/  providers/  commands/  hooks/  data/
```

Validate before publishing:

```bash
claude plugin validate .          # checks the marketplace + plugin manifests
node bin/checklinks.js            # checks every deck URL resolves
```

**Local (development).** Point the marketplace at the working directory. Changes to scripts take effect immediately since the plugin is copied on install — re-run `/plugin marketplace update kappamax` after edits.

```bash
/plugin marketplace add /Users/you/workspace/claude-smart-thinking
/plugin install smart-thinking@kappamax
```

**Git (sharing).** Push to GitHub and others add it by `owner/repo`. Only committed files ship, so `.gitignore` is what defines the package.

```bash
/plugin marketplace add kappamax/claude-smart-thinking
```

**Releasing.** `version` appears in both manifests and pins the plugin — users only receive an update when the string changes, so bump both on every release. **Patch-bump per change** (`0.12.0` → `0.12.1`); reserve a minor bump for something that genuinely changes what the plugin does. A test asserts the two manifests agree, because drift means installs resolve one version while the update check reads the other. Installs land in a version-stamped directory:

```
~/.claude/plugins/cache/kappamax/smart-thinking/0.12.0/
                                                   └── becomes 0.12.1 on update
```

That path *is* `${CLAUDE_PLUGIN_ROOT}`, which is why nothing durable may live inside it and why the SessionStart hook rewrites `statusLine.command` every session. Verified: after a version bump, the hook re-points the status line from `0.1.0` to `0.2.0` with no user action.

## Commands

| Command | Does |
|---|---|
| `/thinking-setup` | Configure providers |
| `/thinking-status` | Cache age, provider state, what's live in settings.json |
| `/thinking-refresh` | Force a refresh now |
| `/thinking-deck [topic]` | Generate or extend the learning deck (link-checked) |
| `/thinking-off` | Remove everything, restore the previous status line |

Plus `node bin/checklinks.js [deck.json]` to verify every "learn more" URL resolves.

## Providers

**learn** — spaced *exposure*, deliberately not spaced repetition. Real SRS needs a recall grade after each review; the spinner is read-only, so there's no signal to schedule against. Instead frequency decays by exposure count (interval doubles, capped at a week), so new material dominates and old material resurfaces.

The starter deck goes deliberately wide — Knuth and TAOCP, biology, history, travel, physics, statistics, economics, cooking, health, language, art, philosophy, geography, design, and a trimmed set of engineering. A few seconds of idle attention suits things that are interesting *out of context*; material needing a running start belongs somewhere you can actually sit with it. Breadth also stops the surface from becoming a second work feed. Copy `data/deck.sample.json` to `~/.claude/smart-thinking/deck.json` to make it yours, or run `/thinking-deck <topic>` to generate more.

**weather** — Open-Meteo, no API key. Promoted to high priority only within `promoteMinutesBefore` of `leaveForWorkAt`, so it appears when it can still change a decision rather than as all-day noise.

**news** — headlines with their article URL, from feeds you list. Handles RSS `<link>` and Atom `<link href>`. Dead feeds are isolated *and* logged to `refresh.log` — a feed that quietly stops contributing otherwise looks identical to one that was never configured.

**context** — facts about the repo you're in right now: drift from upstream, uncommitted volume, a working tree that's gone stale. Scoped to what changes under you and what a typical status line doesn't already show, so it complements rather than duplicates your existing segments.

Adding a provider is a module in `providers/` exporting `collect(cfg, ctx)` returning `{tips, status, warnings}`, registered in `providers/index.js`. `ctx.context` carries the detected topics and git state.

### Context-aware selection

`lib/context.js` detects your stack from manifests (`package.json` deps, `go.mod`, `Cargo.toml`, `requirements.txt`, Dockerfiles, migration dirs) and git state. Cards whose `tag` or `topics` match get their own pool.

Context earns **a share of the slots, not all of them** — `contextShare`, default 0.4:

```
in a React/Postgres repo          in a bare directory
─────────────────────────         ───────────────────
Git — git reflog records…         Travel — decline dynamic currency conversion…
SQL — NULL = NULL is NULL…        Security — nested quantifiers backtrack…
HTTP — 401 vs 403…                Knuth — paused TAOCP to build TeX…
Travel — Global Entry…            Travel — EU261 entitles you to €250–600…
Language — linguistic relativity… Travel — incognito doesn't lower airfare…
Health — nap 20 minutes or 90…    Statistics — regression to the mean…
```

A matching card lands harder — a Postgres note while you're in a Postgres repo beats one in the abstract. But if relevance took every slot the deck would collapse into a second work feed, which is exactly what this surface shouldn't be. The idle seconds are the one place a fact about tardigrades genuinely competes.

## Freshness

The honest position: **the teaching content is static.** The deck and the health
corpus are files. Weather and repo state are live; nothing else is.

Two attempts to make literature live at render time both failed the same way —
a paper title is not a finding, and a background Node process cannot read an
article and decide what is worth teaching. That judgement is the product.

So the judgement is not automated; its *invocation* is:

```bash
bin/harvest.sh digest deep-eng          # read the feeds, write cards
bin/harvest.sh research "sleep debt"    # read the literature, write claims

# weekly, via crontab -e
0 7 * * 1 cd /path/to/claude-smart-thinking && bin/harvest.sh digest curious >> ~/.claude/smart-thinking/harvest.log 2>&1
```

It runs the same command a person would type, headless via `claude -p`, so every
card still went through a reading step.

**Cost.** On a Claude Code subscription this draws on plan usage — the same
five-hour and seven-day windows your status line reports — not API credits and
not an incremental bill. On an API key it bills per token. A run is small either
way: three articles is a few thousand tokens of reading plus a short write. It is
off by default because it starts an autonomous session that edits your deck,
which should be deliberate rather than a surprise.

What this deliberately does not do is surface anything unread. A feed item that
nobody followed is a recommendation nobody checked, and that was the original
complaint about news.

## Config

`~/.claude/smart-thinking/config.json` for Claude Code, or `~/.config/opencode/smart-thinking/config.json` for OpenCode, deep-merged over the defaults in `lib/config.js`.

```jsonc
{
  "linkStyle": "url",             // url | none — tips are sanitized, so OSC 8
                                  //   hyperlinks cannot survive; see above
  "linkColor": "none",            // inert for tips (escapes are stripped)
  "refreshIntervalSeconds": 30,   // status line re-execution cadence
  "contentMaxAgeMinutes": 20,     // staleness before a background refetch
  "tipCount": 12,                 // size of the tip rotation queue
  "statusLine": { "enabled": true, "wrap": "bash ~/.claude/statusline-command.sh" },
  "spinnerVerbs": { "enabled": true, "mode": "replace", "verbs": ["Thinking", "…"] },
  "providers": {
    "learn":   { "enabled": true, "count": 6,
                 "showLinks": true,      // append each card's URL
                 "contextShare": 0.4 },  // max share of slots for stack-matched cards
    "weather": { "enabled": true, "latitude": 42.36, "longitude": -71.06,
                 "units": "fahrenheit", "leaveForWorkAt": "08:45", "promoteMinutesBefore": 60 },
    "news":    { "enabled": true, "maxPerFeed": 3, "maxAgeHours": 24,
                 "feeds": [{ "url": "https://hnrss.org/frontpage", "label": "HN" }] },
    "context": { "enabled": true, "behindWarnThreshold": 20,
                 "dirtyWarnThreshold": 25, "staleHours": 8 }
  }
}
```

## Safety

Your `settings.json` is a file this plugin does not own, so writes to it are constrained:

- Only four keys are ever touched: `spinnerTipsOverride`, `spinnerVerbs`, `spinnerTipsEnabled`, `statusLine`.
- A malformed `settings.json` **aborts the write** rather than being treated as `{}` — never overwrite a file you failed to parse.
- Writes are atomic (temp file → `fsync` → `rename`), so a crash mid-write leaves the original intact.
- A pre-install backup is kept at `~/.claude/smart-thinking/settings.backup.json`.
- No-op writes are skipped, so an unchanged refresh doesn't touch the file at all.
- A single-writer lock keeps concurrent Claude Code windows from interleaving writes.

The status line hot path never blocks on the network, never writes to disk, and fails silent — a crash there would blank the status line you had before installing this.

## Known limits

- **The renderers differ.** Claude Code supplies spinner-tip and status-line settings. OpenCode exposes neither, so its adapter uses temporary TUI toasts during `session.status: busy`. Claude Chat and Cowork still have no equivalent extension point.
- **Tip freshness is bounded by settings reload.** Claude Code caches settings in-process; a watcher reloads them on change for files present at session start. Rewrites are picked up in practice, but if a tip looks stale, `/config` or a new session forces a reload. The status line has no such constraint.
- **Exposure tracking counts tips *supplied*, not displayed** — Claude Code picks which supplied tip to render. Over many refreshes the two converge, since it sorts by least-recently-shown across a stable set of slot ids.

## Development

```bash
node --test                 # 57 unit tests, no dependencies
npm run test:links          # network: deck urls, feeds, and a PubMed audit of the
                            # health corpus for retractions and stale claims
claude plugin validate .
```

Every test in the suite corresponds to a defect that actually shipped: the
duplicate-hooks declaration that made the plugin refuse to load, the strided
pick that returned the same sleep tip twice, `git log` on a commitless repo
dating the last commit to 1970, and actions that merely restated their own
card. The content checks that used to be throwaway scripts run at release time
are now enforced on every commit.

Two of those tests were themselves wrong until mutation testing caught them —
reintroducing the original bug and confirming the suite goes red is worth doing
before trusting a green run.

```bash
# Exercise everything against a throwaway config dir instead of your real one
CLAUDE_CONFIG_DIR=/tmp/fake-claude node bin/refresh.js --root "$PWD" --cwd "$PWD"
CLAUDE_CONFIG_DIR=/tmp/fake-claude node bin/setup.js status
echo '{"model":{"display_name":"Opus 5"},"workspace":{"current_dir":"."}}' \
  | CLAUDE_CONFIG_DIR=/tmp/fake-claude node bin/statusline.js

node bin/checklinks.js                 # verify every deck URL resolves
claude plugin validate .
```

`paths.js` honours `CLAUDE_CONFIG_DIR`, so every path — settings, cache, deck, log — redirects together. Pass `--cwd <dir>` to `refresh.js` to test context detection against a different project.
