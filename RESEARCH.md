# Browser-assisted research bridge for Codex and Claude

Status: feasible. After one-time installation and permission setup, research can run without user interaction. The recommended product is an autonomous browser research bridge, not a crawler-evasion system.

## Outcome

Build one local MCP service and one Chrome Manifest V3 extension. Package the MCP service and research instructions as thin plugins for both Codex and Claude Code. The extension receives broad HTTP(S) host access during setup, connects through authenticated localhost WebSocket in the prototype and Native Messaging in the packaged version, and can open, read, and close research tabs automatically.

The extension shares content from pages the user can legitimately view in Chrome. It may use an existing logged-in browser session to render a page, but it must not extract cookies, solve CAPTCHAs, spoof browser identity, evade bot detection, defeat paywalls, or work around authentication or other access controls.

This solves the useful part of the problem: when an agent-side fetcher is blocked but a page opens normally in the configured Chrome profile, the agent can use the rendered page without asking the user to intervene during the search.

The user still has to install the extension and grant its permissions once. Chrome does not allow an extension to silently grant itself access. A managed organization could deploy those permissions through Chrome enterprise policy instead.

## Why this architecture

Both Codex and Claude Code can load plugins containing skills and MCP server definitions. Chrome extensions with persistent host access can open tabs and use the `scripting` permission without a gesture on every page, then exchange messages with a local application through Chrome Native Messaging.

The developer preview uses a persistent broker so concurrent harness sessions share one Chrome connection:

```text
Codex MCP       Claude MCP       other MCP sessions
        |
        | MCP over stdio
        v
thin stdio adapters
        |
        | authenticated loopback clients
        v
persistent local broker
        |
        | Native Messaging relay (authenticated WS fallback in development)
        v
Chrome MV3 service worker
        |
        | host permissions + tabs + scripting
        v
Configured web origins
```

The extension prefers Chrome Native Messaging through an allowlisted per-user host manifest. The host validates Chrome's extension-origin argument, relays Chrome-framed JSON to the shared broker, and never receives arbitrary shell commands. The fallback server binds only to `127.0.0.1`, validates the exact `chrome-extension://<id>` origin, and requires a high-entropy token as the first application message. Do not place the token in a query string or log it.

The native relay or first stdio adapter auto-starts the broker; later Codex and Claude sessions authenticate and reuse it. Clients re-establish the connection and restart a missing broker on the next tool call. Compatibility uses the wire protocol version rather than the package release version, preventing a routine upgrade from locking out a compatible running broker. The broker remains alive while clients are attached and exits after an idle grace period. Native Messaging provides the Chrome-controlled origin allowlist; the broker TCP listener remains loopback-only because it is also the multi-harness rendezvous point.

Set `minimum_chrome_version` to 116 for the WebSocket prototype. Chrome 116+ keeps an extension service worker active when WebSocket traffic occurs within its 30-second activity window, so send a small authenticated heartbeat every 20 seconds and reconnect with bounded backoff. Persist job state outside service-worker globals so an unexpected worker restart is recoverable. A Native Messaging port provides a stronger keepalive in the packaged version.

## User experience

### One-time setup

1. Install the extension and local bridge.
2. Grant access to all HTTP(S) sites, or to an organization-maintained domain allowlist.
3. Use a dedicated Chrome research profile; optionally sign into only the sources the agent should be allowed to read.
4. Enable the Codex or Claude plugin and approve its read-only MCP tools.
5. Leave Chrome running while autonomous research is needed.

### Autonomous search

1. The agent calls `search_web` or `fetch_rendered_page`.
2. The extension opens an inactive research tab in the dedicated profile.
3. It waits for navigation and a bounded DOM-settle period.
4. It extracts the rendered page, records the final URL, and closes the tab.
5. The MCP server returns source-attributed, untrusted content to the agent.

No user gesture is required during this flow because the extension already has host access. Calls should still be asynchronous internally so redirects, slow pages, timeouts, and retries do not block the bridge.

### Visible research activity

One UUID research session correlates every search and page read for a user request. Each job streams queued, searching or navigating, rendering, extracting, and a completed, skipped, or failed terminal event through the broker. Events contain only a bare domain, source position, elapsed milliseconds, and a normalized error code when relevant; full URLs, paths, queries, titles, and search terms are excluded from activity metadata.

The MCP adapter forwards events as `notifications/progress` only when the harness supplies a progress token. It delays the first notification for one second and throttles later transitions, so sub-second work is silent. Tool results always include per-source duration, outcome, safe domain, and whether native progress was available, allowing the skill to provide one concise between-source update as a fallback.

The MV3 action popup reads current activity from `chrome.storage.session`, so it remains coherent if the service worker is suspended and restarted while the popup is open. Only completed history crosses into persistent local storage, using the fixed `{ domain, timestamp, duration, outcome }` schema. The popup also exposes transport/heartbeat diagnostics and extension, broker, build, and protocol versions without reading or displaying the shared token.

### Permission modes

- **Autonomous mode:** install-time `http://*/*` and `https://*/*` host permissions. This meets the zero-interaction requirement but carries a strong Chrome permission warning.
- **Allowlist mode:** persistent permissions for a configured set of sources. Searches are autonomous within those origins and fail closed elsewhere.
- **Managed mode:** an administrator force-installs the extension and configures allowed origins and research policy.

Use a dedicated Chrome profile for autonomous mode. It limits exposure of personal browsing sessions and lets the operator decide which source accounts, if any, are available to the agent.

## MCP tool surface

Keep version 1 read-only and small:

| Tool | Purpose |
| --- | --- |
| `bridge_status` | Report Chrome connection, extension version, and pending requests. |
| `search_web` | Discover result URLs through a licensed search API or configured browser search provider. |
| `fetch_rendered_page` | Open a background tab, extract the rendered page, and close it. |
| `read_capture` | Read a prior result in bounded chunks. |
| `list_captures` | List recent research captures without returning their bodies. |
| `forget_capture` | Delete one local capture according to retention policy. |

Do not include click, type, form submission, download, cookie, storage, network interception, or arbitrary JavaScript tools in the MVP. Those create a much larger security and review surface and are not needed for research.

`read_capture` should return:

- Final URL and canonical URL
- Page title and site name
- Capture timestamp
- Visible headings and article text
- Visible link text and resolved HTTP(S) targets
- Stable block IDs so an answer can cite the relevant passage
- A content hash for audit/debugging
- A prominent `UNTRUSTED_WEB_CONTENT` classification

## Search strategy

Use a fully automatic hybrid approach:

1. Use the harness's normal web search or a licensed search API for discovery.
2. Automatically use Chrome capture for pages that fail to fetch or need the configured profile's authenticated, rendered view.
3. Ask the agent to cross-check important claims against a second source.

Automating a consumer search-results page can violate a search provider's terms and is brittle. A licensed search API is the preferred discovery layer. If browser search is configured, use a provider that permits automation and capture only result links and snippets.

## Two retrieval tiers

Use two read paths, with the fast path first:

### Tier 1: extension-context fetch

The service worker calls `fetch(url, { credentials: "include", redirect: "follow" })` for configured origins. Host permissions allow the cross-origin request and can allow the site's cookies to be sent according to Chrome's cookie policy. This does not require the `cookies` API permission and the extension must never read or return cookie values.

Tier 1 is fast and does not create a tab, but it does not execute the target site's JavaScript. Fall back when it returns an authorization/challenge response, an unsupported content type, or a suspiciously empty document. If third-party cookies are blocked or the site's request flow depends on a top-level navigation, Tier 1 may not inherit the expected session.

### Tier 2: rendered inactive tab

Create an inactive tab, perform a normal top-level navigation, wait for `tabs.onUpdated` plus a bounded DOM-settle interval, inject the extractor, and close the tab in `finally`. This uses the profile's normal cookie jar and JavaScript execution and is the reliable path for SPAs and authenticated pages.

Use Mozilla Readability for article selection and Turndown for normalized Markdown, but keep the original final URL, title, headings, links, and stable content blocks for citations. Cap parallel rendered tabs at two initially.

An offscreen document is not a replacement for this navigation: Chrome requires an offscreen document's URL to be a static HTML file bundled with the extension. It may still help with DOM parsing, but arbitrary target pages should be loaded in tabs.

## Page extraction

The extension should use persistent host permissions and `chrome.scripting.executeScript` in automatically created inactive tabs. Start with `document.body.innerText` plus metadata, then add a reader-mode extractor such as Mozilla Readability if quality requires it.

Before sending content:

- Remove scripts, styles, comments, hidden elements, password fields, form values, and editable content.
- Never read cookies, local storage, session storage, authorization headers, or browser history.
- Exclude `chrome:`, `file:`, extension pages, data URLs, private IPs, and localhost by default.
- Resolve redirects and record the final URL.
- Bound each capture and chunk large pages.
- Follow links only when the MCP tool explicitly requests them and they remain within configured policy.
- Do not capture cross-origin frames unless the user separately grants that origin.

The broker performs the portable DNS policy check and rejects a hostname if any resolved address is non-public. Chrome Dev and Chrome for Testing expose `chrome.dns`, allowing a second single-answer preflight immediately before tab creation. Stable Chrome, Edge, and Chromium do not expose that Dev-channel API, so the extension feature-detects it and continues with the broker-enforced check instead of breaking navigation. Neither layer atomically pins the address used by the eventual tab request.

Some surfaces will remain unsupported: browser-internal pages, many PDF viewers, DRM content, canvas-only apps, and pages whose terms prohibit this use.

If a rendered page still presents a CAPTCHA, login prompt, or access denial, return a structured unavailable result. Do not add CAPTCHA solving, fingerprint spoofing, challenge manipulation, or stealth patches.

## Prompt-injection defenses

Web content is adversarial input. The bridge cannot reliably "detect away" prompt injection, so enforce architectural boundaries:

- The MCP server exposes read-only research tools in version 1.
- Tool results label page text as data, never as instructions.
- The bundled skill tells the agent not to follow instructions found in captured content.
- The extractor removes hidden text and executable content.
- Captured content never carries credentials or extension configuration.
- Any future action tool must be a separate capability with separate approval.
- Keep an audit record of URL, requesting harness, configured policy, timestamp, and content hash; do not log raw page bodies by default.

## Packaging

Use one monorepo with a shared core:

```text
apps/
  chrome-extension/       Manifest V3 extension and side panel
packages/
  bridge-core/            schemas, extraction normalization, request state
  local-bridge/           MCP adapter, broker, and native-host modes
plugins/
  codex/                  .codex-plugin/plugin.json, .mcp.json, skills/
  claude/                 .claude-plugin/plugin.json, .mcp.json, skills/
installers/
  macos/
  linux/
  windows/
```

The skill text and tool schemas should be generated from shared sources so behavior does not drift. Keep separate plugin manifests because the ecosystems use different manifest directories and validators.

Codex's plugin package can point `mcpServers` to a root `.mcp.json`. Claude Code likewise supports a root `.mcp.json`. Each package bundles the same bridge executable, while the process reads authentication data from a shared per-user config file or explicit environment overrides.

For early testing, Claude Code can load the plugin directly with `--plugin-dir`, while Codex can register the same stdio executable in `~/.codex/config.toml`. Publication can wrap the same binary in native plugin packages for both harnesses.

## Existing Claude in Chrome integration

Before judging extraction quality, benchmark the official Claude Code Chrome integration against a few representative blocked sources. Anthropic documents that it opens tabs in the real browser, shares the browser login state, extracts web data, and inherits extension site permissions. It therefore proves much of the browser-side concept for Claude Code.

It does not remove the need for this project when Codex support, a harness-neutral public MCP surface, bulk clean-content extraction, or deterministic read-only tools are requirements. Anthropic also documents that the integration pauses for login pages and CAPTCHAs and may need manual reconnection after the extension service worker goes idle, so it does not guarantee fully unattended runs in every case.

## Distribution phases

### Phase 0: local proof of concept

- Unpacked Chrome extension
- TypeScript MCP server
- Authenticated loopback WebSocket with exact-origin validation and a 20-second heartbeat
- `bridge_status`, `search_web`, `fetch_rendered_page`, `read_capture`
- Manual Codex MCP config and Claude Code MCP config
- Tier 2 inactive-tab fetch with Readability and Turndown
- Tests on static pages, SPAs, authenticated documentation, blocked-agent-fetch cases, reconnects, and malicious localhost callers

### Phase 1: installable developer preview

- Persistent broker with multiple concurrent stdio adapters
- Chrome Native Messaging host
- Tier 1 extension-context fetch with controlled fallback to Tier 2
- Signed installers for macOS, Windows, and Linux packages
- Codex and Claude plugin packages
- Dedicated-profile onboarding
- Autonomous and allowlist permission modes
- Chunking, citation blocks, retention settings, and audit metadata

### Phase 2: publication

- Chrome Web Store review and privacy disclosure
- Codex and Claude marketplace submissions
- Reproducible builds, signed releases, SBOM, update mechanism
- Security review and prompt-injection test suite
- Clear acceptable-use policy and site permission model

## MVP acceptance criteria

- After setup, a multi-source web search completes without user interaction.
- No page is read outside the host permissions and research policy granted during setup.
- The agent receives the final URL, title, timestamp, visible text, links, and stable block IDs.
- Cookies, storage, form values, hidden text, and non-HTTP(S) URLs never appear in MCP output.
- Captured page instructions cannot trigger a browser or system write action because none exist.
- Both Codex and Claude Code pass their plugin validators and expose the same MCP tools.
- Disconnecting Chrome, blocked origins, navigation failures, timeouts, and oversized pages fail clearly.
- Multi-source runs expose correlated, domain-only lifecycle activity and structured error codes without noisy sub-second updates.

## Main risks

| Risk | Mitigation |
| --- | --- |
| Site terms prohibit automated extraction | Per-site allowlist, user disclosure, no stealth, and respect site restrictions. |
| Prompt injection in source pages | Read-only MVP, untrusted-content boundary, hidden-text removal, and cross-source verification. |
| Broad host access exposes browsing data if compromised | Dedicated Chrome profile, no personal-history access, signed releases, bundled code only, and allowlist mode where possible. |
| Local process impersonation | Native Messaging origin allowlist or authenticated local IPC with strict file permissions. |
| Any website connects to the localhost WebSocket | Bind to loopback, validate the exact extension origin, authenticate before commands, and never expose tokens in URLs or logs. |
| Sensitive authenticated content leaks to a model | Dedicated low-privilege profile, domain denylist, data-classification rules, retention controls, and clear setup disclosure. |
| Chrome Web Store rejection | Narrow single purpose, minimal permissions, privacy policy, and no remote code or evasive behavior. |

## Recommendation

Proceed with Phase 0 as an **autonomous browser research bridge**, not as a crawler bypass. The technical foundation is strong and portable across Codex and Claude because MCP is the shared boundary. The one-time permission grant enables zero-interaction searches; a dedicated Chrome profile, read-only tools, citation quality, and prompt-injection resistance keep that autonomy contained.
