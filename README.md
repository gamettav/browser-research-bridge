# Browser Research Bridge

An early, read-only bridge that lets Codex and Claude Code search and read rendered pages through a local Chrome profile. After one-time setup, MCP tool calls open inactive tabs, extract source content, and close the tabs without requiring interaction during ordinary searches.

This is not an anti-bot or access-control bypass. It does not solve CAPTCHAs, spoof fingerprints, extract cookies, submit forms, or circumvent login and payment requirements.

## What works

- `bridge_status`: confirm Chrome is connected.
- `search_web`: collect links and snippets from DuckDuckGo, Bing, or Google in a real tab.
- `fetch_rendered_page`: render a public HTTP(S) page, extract readable Markdown, links, and metadata, and close the tab.
- `list_captures` and `read_capture`: paginate stable citation blocks retained for the current MCP process.
- Shared stdio MCP binary for Codex and Claude Code.
- A persistent local broker shared by concurrent Codex and Claude MCP sessions.
- Chrome MV3 service worker with Native Messaging, exact-origin mutual HMAC authentication, and a loopback WebSocket fallback that never transmits the shared token.
- Broker DNS preflight for initial and final URLs, plus an additional Chrome-side preflight when the Dev-channel-only `chrome.dns` API is available.

The current preview implements the rendered-tab path, shared broker, and macOS/Linux Native Messaging packaging. The faster extension-context `fetch()` tier remains follow-up work.

## Build

Requirements: Node 20.11+, pnpm, Chrome 116+.

```sh
pnpm install
pnpm check
```

Build outputs:

- Chrome extension: `apps/chrome-extension/dist`
- MCP server: `packages/mcp-server/dist/index.cjs`
- Persistent broker: `packages/mcp-server/dist/broker.cjs`
- Native Messaging relay: `packages/mcp-server/dist/native-host.cjs`
- Packaged server copies under both `integrations/*/browser-research/server`

## Automated browser acceptance test

For development, launch an isolated Chrome profile with the unpacked extension and remote debugging enabled, then run:

```sh
pnpm e2e:browser
```

The test discovers the extension ID without printing the generated token, configures the extension in the disposable profile, starts two independent stdio MCP clients, proves they share one auto-started broker, performs two parallel rendered fetches, and verifies concurrent SSRF regression URLs fail closed. `BROWSER_RESEARCH_CDP_PORT` and `BROWSER_RESEARCH_E2E_CONFIG` override the default test port and temporary config path.

With a configured browser already running, the representative-source suite is available as:

```sh
BROWSER_RESEARCH_E2E_CONFIG='/path/to/test-config.json' \
pnpm --filter @browser-research/mcp-server e2e:sources
```

It verifies a static source, a rendered documentation source, a redirect, session-cookie continuity, access-denial detection, and a robots-restricted public source that can still be legitimately displayed in Chrome.

The non-browser lifecycle acceptance test is included in `pnpm check`; it verifies idempotent setup, doctor, conservative uninstall, configuration retention, and complete removal in a disposable directory.

## One-time Chrome setup

1. Create a dedicated, low-privilege Chrome profile. This is a security requirement for the current preview, not an optional recommendation. Sign into only the sources this research agent should be allowed to read.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/chrome-extension/dist`. Approve the requested site and Native Messaging permissions. The manifest also declares `dns` for an additional check available only in Chrome Dev/Chrome for Testing; Stable Chrome safely falls back to the broker check.
3. Open the extension options. Copy the displayed extension ID.
4. Run the setup command using the displayed extension ID:

   ```sh
   node scripts/browser-research.mjs setup \
     --extension-id '<extension-id>' \
     --browser chrome
   ```

   It generates or preserves a high-entropy token, writes `~/.config/browser-research/config.json` with private permissions, and installs the Native Messaging runtime. Paste the printed token into the extension options and save. The token is shown because this is the one value Chrome and the local harness must share; setup never logs it elsewhere.
5. Run the installation doctor:

   ```sh
   node scripts/browser-research.mjs doctor --browser chrome
   ```

Supported browser values are `chrome`, `chrome-for-testing`, `chromium`, and `edge`. Native Messaging requires the token and extension ID in the default config file, or in a file explicitly pinned with `--config-path`; an environment-only MCP setup is insufficient because Chrome starts the host independently. Setup copies the host and broker beside Chrome's per-user manifest and writes a small launcher pinned to the current absolute Node path, avoiding both Chrome's minimal `PATH` and macOS Desktop-folder privacy restrictions. Re-run setup after changing the build or Node runtime.

To remove the native host while keeping the configuration for a later reinstall:

```sh
node scripts/browser-research.mjs uninstall --browser chrome
```

Add `--remove-config` to remove the token-bearing configuration too. Uninstall validates the manifest and exact extension origin before removing its files and refuses unexpected targets.

The MCP server reads that shared file by default, so installed Codex and Claude plugins do not depend on globally exported secrets. Set `BROWSER_RESEARCH_CONFIG` to use another path. Explicit `BROWSER_RESEARCH_TOKEN`, `BROWSER_RESEARCH_EXTENSION_ID`, and `BROWSER_RESEARCH_PORT` environment variables override file values for development and CI.

The extension requests access to HTTP(S) sites because unattended rendering cannot rely on `activeTab`. Chrome shows this broad permission during installation. You can restrict its site access in Chrome, but autonomous calls outside those origins will then fail.

## Run the MCP server directly

```sh
BROWSER_RESEARCH_TOKEN='<generated-token>' \
BROWSER_RESEARCH_EXTENSION_ID='<extension-id>' \
node packages/mcp-server/dist/index.cjs
```

The optional port defaults to `32189`. The extension first asks Chrome to start the allowlisted Native Messaging relay. That relay auto-starts the detached broker when needed and forwards only framed JSON between Chrome and the broker. If the host is not installed, the extension falls back to an authenticated loopback WebSocket. Later Codex and Claude sessions authenticate to and reuse the same broker, which exits ten minutes after the last MCP client disconnects. MCP clients reconnect and restart the broker after a mid-session broker failure. Compatibility is gated by the wire `PROTOCOL_VERSION`, so ordinary release upgrades can reuse a running compatible broker.

## Codex

The quickest development setup uses the built server directly:

```sh
codex mcp add browser-research \
  --env BROWSER_RESEARCH_TOKEN='<generated-token>' \
  --env BROWSER_RESEARCH_EXTENSION_ID='<extension-id>' \
  -- node '/absolute/path/to/vebicrolly/packages/mcp-server/dist/index.cjs'
```

The installable Codex plugin is at `integrations/codex/browser-research`. Its manifest contains the bundled MCP definition directly, and the process reads the shared config file above.

## Claude Code

For local development, launch Claude Code with the plugin directory. It reads the same shared config file:

```sh
claude --plugin-dir ./integrations/claude/browser-research
```

Claude Code starts the plugin's stdio MCP server automatically. Use `/mcp` to inspect its connection.

## Security model

- Only public `http:` and `https:` URLs are accepted. Localhost, internal/reserved hostnames, wildcard loopback services, private/special IPv4 ranges, IPv4-mapped IPv6, and non-global IPv6 ranges are blocked. The broker resolves every requested fetch hostname and rejects it if any answer is non-public. Chrome Dev/Chrome for Testing additionally checks the single answer exposed by `chrome.dns` immediately before creating the initial tab. Stable Chrome, Edge, and Chromium do not expose that API and rely on the mandatory broker check.
- Both loopback peer types use nonce-based HMAC-SHA-256 challenge-response. The broker proves token possession before the extension or MCP client responds, and the 256-bit token never crosses the socket. Extension connections additionally require the exact `chrome-extension://<id>` origin.
- Research tabs are inactive, limited to two concurrent jobs, and closed in a `finally` block.
- The persistent broker owns the global two-job ceiling, absolute job deadlines, and queue; additional jobs cannot outlive the requesting timeout or disappear with an MV3 worker suspension.
- A 30-second `chrome.alarms` wake-up backs up the normal reconnect timer, allowing the MV3 worker to reconnect after an MCP process restarts.
- The extractor removes forms, form controls, editable elements, scripts, styles, hidden elements, SVG, and canvas content.
- MCP output is labeled `UNTRUSTED_WEB_CONTENT`, and the bundled skill tells the harness never to obey page instructions.
- Page bodies live only in each requesting MCP process's memory; the store retains at most 50 captures and evicts the oldest first.

The broker resolves the initial URL and re-resolves Chrome's final URL before extraction. The extension re-reads `tab.url` immediately before extraction and rejects any change. These checks prevent returning content from a destination that fails policy, but they are not an atomic network sandbox: Chrome can issue a redirect request before the final URL is known, and DNS can change between validation and navigation. The dedicated low-privilege Chrome profile is therefore the actual containment boundary.

## Current limitations

- Search-engine markup changes can break result extraction.
- PDF viewers, canvas-only apps, browser-internal URLs, file URLs, and some cross-origin frames are unsupported.
- A site may detect automation or disallow extraction even in a normal Chrome tab.
- Login pages, CAPTCHA pages, access denials, and obvious challenges return errors instead of being bypassed.

See [RESEARCH.md](./RESEARCH.md) for the full architecture and roadmap.
