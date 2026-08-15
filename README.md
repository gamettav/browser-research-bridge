<p align="center">
  <img src="apps/chrome-extension/static/icon-128.png" width="104" alt="GroundTab icon">
</p>

<h1 align="center">GroundTab</h1>

<p align="center">
  Let Codex and Claude Code read the web through Chrome when ordinary crawling comes back blocked, empty, or half-rendered.
</p>

<p align="center">
  <img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome-MV3-185743">
  <img alt="Model Context Protocol" src="https://img.shields.io/badge/MCP-local-185743">
  <img alt="Read only" src="https://img.shields.io/badge/browser-read--only-185743">
  <a href="LICENSE"><img alt="Apache 2.0 license" src="https://img.shields.io/badge/license-Apache--2.0-185743"></a>
</p>

Your agent searches, compares sources, and writes the answer. Chrome handles the pages that need a real browser. GroundTab connects the two over localhost and returns clean text with the final source URL.

Everything runs on the user's machine: the broker stays on localhost, the extension returns page text rather than cookie values, and access barriers stay barriers.

```text
You:    Check whether Chrome changed its extension install policy this year.
Agent:  Searching DuckDuckGo…
        Reading 1 of 3 — developer.chrome.com
        Reading 2 of 3 — chromium.org
        ✓ Answer with citations
```

## Install twice. Pair once.

The public install flow has three steps:

1. Add **GroundTab** from the Chrome Web Store.
2. Install the **GroundTab** plugin in Codex or Claude Code.
3. Ask the agent to **“set up GroundTab”** and enter its one-time code in the extension.

That is the whole user setup. The agent plugin starts the local MCP broker itself. Users do not clone this repository, install Native Messaging, download a second Chrome, enable Developer Mode, copy an extension ID, or paste a permanent token.

> [!IMPORTANT]
> GroundTab's Chrome extension is awaiting Web Store review. The Codex and Claude listings are not live yet. Install buttons will become active as each listing is approved.

## Where it helps

| The page | What GroundTab does |
| --- | --- |
| Plain HTML | Fetches and extracts it without opening a tab |
| JavaScript shell | Opens an inactive tab, waits for the DOM to settle, then extracts |
| 401, 403, login, or challenge | Reports the barrier instead of pretending it read the page |
| One source fails | Tries a replacement source and avoids hammering the same domain |
| Search markup changes | Fails over from DuckDuckGo to Bing to Google |
| Sources disagree | Keeps the claims separate and cites both sides |
| Evidence is too thin | Returns `Research incomplete` instead of filling the gap from memory |

A successful extension-context fetch avoids creating a tab. Rendered navigation is reserved for pages that prove they need it.

## Speed

GroundTab runs the static extractor before it pays the cost of creating and settling a tab. On an Apple M4 with Brave 151, a local 11,874-byte article produced these results across 25 measured runs after five warmups:

| Path | Median | p95 | Extracted text |
| --- | ---: | ---: | ---: |
| Static extension-context fetch | 6.0 ms | 18 ms | 11,216 chars |
| Rendered inactive tab | 240 ms | 262 ms | 11,216 chars |

The static path was 40.0× faster at the median. This benchmark removes network variance and runs the packaged GroundTab extractors on both paths. It measures browser fetch, extraction, tab creation, DOM settling, and cleanup, not arbitrary website load time.

Run it on your machine with `pnpm benchmark:fetch`. The benchmark uses a local fixture, opens a temporary headless Chrome, Brave, or Chromium profile, and deletes that profile after the browser exits.

## Token use

GroundTab sends bounded readable Markdown to the agent, not screenshots, raw HTML, or browser state. Static fetch and rendered-tab fallback produced the same 11,216-character extraction in the benchmark above, so falling back to Chrome rendering did not add model-token cost. That fixture is roughly 2,800 English-language tokens before source metadata; the exact count depends on the model tokenizer.

For the same returned text, GroundTab uses effectively the same model tokens as a regular text crawler. Chrome work happens outside the model context; tokens are spent only on the extracted text and citation metadata returned to the agent.

## How it fits together

```text
Codex / Claude Code
        │  MCP over stdio
        ▼
GroundTab agent plugin
        │  mutual authentication on 127.0.0.1
        ▼
GroundTab for Chrome
        ├─ static HTML  → extract without a tab
        └─ JS required → render in an inactive tab
                           │
                           ▼
                  bounded text + final URL
```

The first MCP launch creates a private 256-bit credential. Pairing uses a separate 64-bit code that expires after ten minutes and locks after five incorrect attempts. The extension sends a proof derived from the code, not the code itself. Once paired, the broker accepts only that exact Chrome extension origin.

## Research behavior

The bundled `$browse` and `/browse` workflows do more than call a page reader:

- rank primary and official sources first;
- search DuckDuckGo, then Bing, then Google when a provider fails;
- retry one transient navigation failure;
- replace blocked sources and quarantine repeatedly failing domains;
- collapse canonical, duplicate, and syndicated results;
- seek independent confirmation for consequential claims;
- preserve disagreements instead of averaging them away;
- stop when the material claims have enough evidence;
- carry one deadline and cancellation signal across the whole run;
- audit citation coverage before answering.

Page text is always untrusted input. Instructions embedded in a website do not get to redirect the research task, request files, reveal secrets, or authorize more tools.

## Security boundary

GroundTab can read policy-allowed pages available to the Chrome profile where it is installed. That power is intentionally narrower than browser automation:

- no click, type, submit, download, or form tool;
- no cookie values, storage, history, or form-field values in agent output;
- no CAPTCHA solving, stealth, fingerprint spoofing, or paywall bypass;
- localhost and private network destinations fail closed;
- requested and final hostnames are resolved and checked before extraction;
- banking, healthcare, administration, email, and password-manager domains are denied by default;
- captures and body-free audit records stay bounded and process-local;
- no remote telemetry by default.

The extension needs HTTP(S) site access to research without asking for an `activeTab` click on every page. Chrome can restrict that access to an allowlist. People who keep sensitive services signed in can use a separate low-privilege profile for a stronger boundary. Read the full [security policy](SECURITY.md) and [privacy policy](PRIVACY.md).

## MCP tools

| Tool | Purpose |
| --- | --- |
| `bridge_status` | Start/check the broker and provide the first-run pairing code |
| `search_web` | Search through DuckDuckGo, Bing, or Google |
| `fetch_rendered_page` | Read a public page through static fetch or rendered fallback |
| `list_captures` / `read_capture` | Read bounded citation blocks from the current process |
| `export_audit_report` | Export a body-free local research audit |
| `delete_capture` / `clear_captures` / `clear_audit_log` | Explicit destructive maintenance, never pre-approved by the browse skill |

## Distribution

The repository produces three packages:

- Chrome Web Store extension: `apps/chrome-extension/dist`
- Codex plugin: `integrations/codex/groundtab`
- Claude Code plugin: `integrations/claude/groundtab`

The current Chrome upload archive is generated with `pnpm package:extension`. Publisher steps, permission copy, and the clean-machine release gate live in [DISTRIBUTION.md](DISTRIBUTION.md).

## Maintainer setup

These commands are for contributors and release maintainers, not product installation:

```sh
pnpm install
pnpm check
```

`pnpm check` validates generated skills, runs the research-quality fixtures, typechecks every package, runs the protocol/extension/server suites, builds the site and release packages, and completes a built-artifact pairing test.

Useful commands:

```sh
pnpm build                 # build the site, extension, MCP server, and plugins
pnpm package:extension     # create the Chrome Web Store zip
pnpm benchmark:fetch       # compare static fetch with rendered-tab fallback
pnpm evaluate:research-quality
```

Requirements: Node 20.11+ and pnpm 10. The marketplace plugins currently launch their bundled server through `node`; a future platform package can bundle a runtime for machines without Node on `PATH`.

## Release status

The technical MVP is green: static fetch, rendered fallback, policy enforcement, cancellation, provider recovery, source-quality checks, pairing, plugin validation, and the clean built-package pairing flow all pass locally.

Public availability still depends on three publisher reviews:

- Chrome Web Store
- Codex plugin directory
- Claude Code marketplace

The release is public-user ready when a clean machine completes this exact path without repository access:

```text
Add to Chrome → install agent plugin → ask to set up → enter code
→ connected → search → static fetch → rendered fallback
```

Architecture and longer-term work are tracked in [RESEARCH.md](RESEARCH.md). The code is licensed under [Apache 2.0](LICENSE).
