# MVP acceptance ledger

Last updated: 2026-08-13

## Passed

- v0.4 mutual HMAC challenge-response on both loopback peer types; malicious port-squatter and wrong-secret regressions prove the shared token is never sent before broker identity is established.
- Final URLs are re-resolved in the broker and the tab URL is re-read immediately before extraction; unsafe or changed final destinations are rejected before content is returned.
- Broker-owned concurrency queue uses absolute deadlines and survives MV3 worker suspension; disconnects fail in-flight work explicitly.
- Protocol v2 reports schema/version errors directly and exposes build identity; doctor detects stale copied runtimes and broken pinned Node executables.
- Official Stable Chrome 151 v0.4 acceptance passed rendered fetch, search, session-cookie, redirect, access-denial, crawler-restricted Bloomberg, concurrent Codex/Claude, and broker-kill recovery tests.
- Complete browser suite in official Google Chrome Stable 151.0.7922.138, including Native Messaging, rendered extraction, search, and SSRF regressions.
- Real installed Codex and Claude Code CLIs fetched rendered pages concurrently through one Stable Chrome profile; an observer measured four broker clients during overlap.
- Representative source coverage: static page, rendered documentation page, redirect, session-cookie continuity, access-denial detection, and Bloomberg Technology, which the generic crawler reported as blocked by robots.txt but Stable Chrome legitimately rendered.
- A verified broker process was terminated during a real Codex/Claude run. Codex observed one transient failure and recovered on retry without restarting; Claude's existing process continued successfully after the broker restart.
- Setup and doctor passed after changing the pinned Native Messaging runtime from NVM Node to Homebrew Node; Stable Chrome spawned the host from the new absolute runtime path.
- Codex plugin manifest validation.
- Claude Code plugin manifest validation.
- Real Codex CLI loaded the packaged MCP server and called `bridge_status`.
- Real Claude Code loaded the packaged MCP server and called `bridge_status`.
- Native Messaging framing, origin restriction, authentication, broker auto-start, and MCP round trip.
- Concurrent Codex/Claude-style MCP clients share one persistent broker.
- Broker reconnect after a mid-session failure and compatible cross-release reuse.
- Stable-browser behavior when the Dev-channel-only `chrome.dns` API is absent.
- Static URL policy and broker all-answer DNS enforcement regression suites.
- Idempotent setup, private shared configuration, runtime doctor, safe uninstall, and optional configuration removal.
- In-memory capture retention bounded to the newest 50 captures per MCP process.

## MVP release status

The technical MVP acceptance criteria are complete. The session-cookie fixture proves authenticated-profile continuity without using or disclosing personal credentials; a release candidate should additionally be smoke-tested against one source explicitly authorized in the dedicated production profile before broader distribution.

## Deferred until after MVP

- Chrome Web Store and public marketplace publication.
- Signed installers and automatic updates.
- Windows packaging.
- Tier-1 extension-context fetch optimization.
- Licensed search API integration and search-provider fixture maintenance.
