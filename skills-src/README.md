# Browse command — canonical source

`/browse` (Claude), `/br:browse` (Claude plugin), and `$browse` (Codex) are all the
**same research command**, generated from one canonical definition so the harnesses can
never drift apart. Generated artifacts are validated against the real harness loaders by
`pnpm validate:skills`, which is part of `pnpm check`.

## Source of truth

- **`skills-src/browse.mjs`** — the canonical definition. **Edit this file, never the
  generated ones.**
- **`scripts/generate-skills.mjs`** — the generator (`pnpm generate:skills`, also the first
  step of `pnpm build`). Exports `buildArtifacts()` (pure) so the validator can compare.
- **`scripts/validate-skills.mjs`** — parses the committed artifacts with a real YAML parser,
  asserts they match the canonical output, checks the Codex schema/location, and fails if any
  command frontmatter would not load. Run by `pnpm validate:skills` / `pnpm check`.
- **`scripts/install-skills.mjs`** — installs the Claude user skill into a config dir.

## Generated artifacts (do not hand-edit)

| Path | Harness | Invoked as |
| --- | --- | --- |
| `integrations/claude/user-skills/browse/SKILL.md` | Claude Code (user skill) | `/browse`, plus implicit activation |
| `integrations/claude/br/.claude-plugin/plugin.json` + `br/commands/browse.md` | Claude Code (plugin `br`) | `/br:browse` |
| `integrations/codex/browser-research/skills/browse/SKILL.md` | Codex (plugin skill) | `$browse`, plus implicit activation |
| `integrations/codex/browser-research/skills/browse/agents/openai.yaml` | Codex (skill UI metadata) | display name / short description / default prompt / MCP tool dependency |

The generator wipes each generated tree before writing, so renames and relocations never
leave stale artifacts. Generation is idempotent. The retired `web-research` skill has been
removed from both plugins — `browse` is the single packaged research skill.

## Install

**Claude user skill (`/browse`):**

```sh
pnpm install:skills                       # installs into $CLAUDE_CONFIG_DIR or ~/.claude
node scripts/install-skills.mjs --config-dir ~/.claude-personal   # explicit target
```

**Claude portable plugin (`/br:browse`)** — add `integrations/claude/br` as a plugin. It is a
thin command layer that relies on the `browser-research` MCP server already being configured.

**Codex (`$browse`)** — install the plugin from the bundled local marketplace:

```sh
codex plugin marketplace add "$PWD/integrations/codex"
codex plugin add browser-research@browser-research-local
codex plugin list      # browser-research → installed, enabled
```

## Behavior (all harnesses)

- **Modes:** `quick:` (one authoritative primary source for a simple fact), default (up to
  3–4 useful sources), `deep:` (multi-angle, up to 5–8); stop early once evidence is sufficient.
- **Direct URLs:** read them first without search; recover a topical alternative only when
  the request is not specifically about the inaccessible page itself.
- **Provider recovery:** configured order, or DuckDuckGo → Bing → Google; fail over on an
  error, challenge, or empty/duplicate-only result set.
- **Workflow:** one session deadline → search/failover → canonical deduplication and
  authority/recency ranking → bounded reading/retry → claim/source ledger → citation audit.
- **Evidence:** consequential claims need two independent sources; syndicated copies count
  once, disagreements stay visible, and insufficient evidence returns exactly
  `Research incomplete` before cited partial findings.
- **No questions during ordinary research.**
- **Structured recovery:** transient navigation fails once then moves domains; blocked
  domains are not retried; a broker/service-worker interruption gets one same-session restore
  attempt within the original deadline; harness cancellation stops queued/in-flight work.
- **Deterministic footer:** `Discovered N · Read N · Sources used N · Skipped N` where
  Discovered = unique normalized result URLs, Read = unique pages successfully extracted,
  Used = read pages cited in the answer, Skipped = attempted-then-failed/rejected pages.
- **Internals hidden** (tool names, ports, UUIDs, block IDs) during ordinary use.

## Manual test matrix

Run these in a real Claude and Codex session after installing.

Explicit:
- `/browse latest stable Deno version` → cited answer + footer.
- `/browse quick: who maintains zod` → terse, one authoritative source.
- `/browse deep: compare pnpm vs npm workspaces` → multiple sources, disagreements reconciled.
- `/browse https://nodejs.org/en/about/previous-releases` → reads the URL directly, no search.

Implicit (should trigger without the slash): "research what changed in React 19",
"look this up: current Bun version", "browse the web for the Next.js 15 release date".

Negative (should NOT trigger browse): "refactor this function to async", "what's 17 * 23",
"explain this stack trace in my local file".
