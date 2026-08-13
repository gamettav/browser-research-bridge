# Browse command — canonical source

`/browse` (Claude), `/br:browse` (Claude plugin), and `$browse` (Codex) are all the
**same research command**, generated from one canonical definition so the harnesses can
never drift apart.

## Source of truth

- **`skills-src/browse.mjs`** — the canonical definition: metadata, the read-only tool
  allowlist, the description that drives natural-language activation, the argument hint, and
  the full research workflow body (modes, workflow steps, policies, failure rules, output
  footer, hidden-internals rule, debug mode). **Edit this file, never the generated ones.**
- **`scripts/generate-skills.mjs`** — the generator. Run `pnpm generate:skills` (also runs
  automatically as the first step of `pnpm build`).

## Generated artifacts (do not hand-edit)

| Path | Harness | Invoked as |
| --- | --- | --- |
| `integrations/claude/user-skills/browse/SKILL.md` | Claude Code (user skill) | `/browse`, plus implicit activation |
| `integrations/claude/br/.claude-plugin/plugin.json` + `br/commands/browse.md` | Claude Code (plugin `br`) | `/br:browse` |
| `integrations/codex/browser-research/skills/browse/SKILL.md` | Codex (plugin skill) | `$browse`, plus implicit activation |
| `integrations/codex/browser-research/agents/openai.yaml` | Codex (agent metadata) | name / description / default prompt / tool deps |

The generator wipes each generated tree before writing, so renames in the canonical file
never leave stale artifacts. Generation is idempotent.

## Install

**Claude user skill (`/browse`)** — copy into your Claude config's skills dir:

```sh
mkdir -p "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/browse"
cp integrations/claude/user-skills/browse/SKILL.md "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/browse/"
```

**Claude portable plugin (`/br:browse`)** — add `integrations/claude/br` as a plugin. It is a
thin command layer and relies on the `browser-research` MCP server already being configured
(via the main plugin or `browser-research.mjs setup`).

**Codex (`$browse`)** — ships inside the `integrations/codex/browser-research` plugin
alongside the MCP server; no extra step.

## Behavior (all harnesses)

- **Modes:** `quick:` (one source, terse), default (rank + read top 3–4 in parallel, compare,
  cite), `deep:` (multi-angle, 5–8 sources, aggressive alternative recovery).
- **Direct URLs:** if the argument is a URL or list of URLs, skip search and read them.
- **Workflow:** connection check → search → source ranking → parallel reading →
  alternative-source recovery → claim comparison → citation of **final** URLs.
- **No questions during ordinary research** — proceed on the best interpretation.
- **Failure rules:** CAPTCHA / login / timeout (retry once) / access-denied all → skip and
  recover with an alternative source; never circumvent.
- **Visible activity:** reuse one session UUID, count ranked sources, prefer throttled native
  lifecycle progress, and use one domain-only fallback line for operations lasting at least
  one second when native progress is unavailable.
- **Footer:** `Discovered N · Read N · Sources used N · Skipped N · Time Ns`.
- **Internals hidden** (tool names, ports, UUIDs, block IDs) during ordinary use; reveal via
  `/browse debug last` (or `$browse debug last`).

## Manual test matrix

Run these in a real Claude and Codex session after installing.

Explicit:
- `/browse latest stable Deno version` → answers with a cited final URL + footer.
- `/browse quick: who maintains zod` → terse, one source.
- `/browse deep: compare pnpm vs npm workspaces` → multiple sources, disagreements reconciled.
- `/browse https://nodejs.org/en/about/previous-releases` → reads the URL directly, no search.
- `/browse debug last` → shows tool calls, requested vs final URLs, block IDs, timings.

Implicit activation (should trigger without the slash):
- "research what changed in React 19"
- "look this up: current Bun version"
- "browse the web for the Next.js 15 release date"

Negative (should NOT trigger browse):
- "refactor this function to async"
- "what's 17 * 23"
- "explain this stack trace in my local file"
